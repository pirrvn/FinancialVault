import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { parseStatement, StatementParseError, type InstitutionId, type ParsedTransaction } from "../parsers";
import { merchantDisplayName, merchantKey } from "../categorization/merchant";
import { runPipeline } from "../categorization/pipeline";
import { DEFAULT_CATEGORIES, PRIORITY } from "../categorization/defaults";
import { categorizeWithAi, describeAiError } from "../ai/categorize";
import { aiConfigured } from "../ai/client";
import { foldText } from "../text";
import { syncDefaults } from "./user";
import { isoDay } from "../dates";
import type { RuleLike } from "../categorization/rules";

export interface ImportSummary {
  batchId: string;
  fileName: string;
  institution: InstitutionId;
  accounts: string[];
  rowsParsed: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsSkipped: number;
  byRule: number;
  byAi: number;
  byFallback: number;
  needsReview: number;
  warnings: string[];
}

/**
 * Stable per-row identity. The occurrence index distinguishes genuinely identical rows
 * (two €2.50 coffees on the same day) while keeping re-imports of the same or an
 * overlapping statement idempotent.
 */
export function fingerprintRows(rows: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.accountRef}|${isoDay(r.date)}|${r.amountCents}|${foldText(r.rawDescription)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 32);
  });
}

export async function importStatement(userId: string, fileName: string, bytes: Uint8Array, institutionHint?: InstitutionId | null): Promise<ImportSummary> {
  let parsed;
  try {
    parsed = parseStatement(bytes, fileName, institutionHint);
  } catch (err) {
    if (err instanceof StatementParseError) throw err;
    throw new StatementParseError(`Failed to read "${fileName}": ${(err as Error).message}`);
  }

  // Resolve (or create) one account per account ref in the file.
  const accountByRef = new Map<string, { id: string; name: string; balanceAsOf: Date | null }>();
  for (const tx of parsed.transactions) {
    if (accountByRef.has(tx.accountRef)) continue;
    const account = await prisma.account.upsert({
      where: { userId_institution_externalRef: { userId, institution: parsed.institution, externalRef: tx.accountRef } },
      update: {},
      create: { userId, institution: parsed.institution, externalRef: tx.accountRef, name: tx.accountLabel, currency: tx.currency },
    });
    accountByRef.set(tx.accountRef, { id: account.id, name: account.name, balanceAsOf: account.balanceAsOf });
  }

  const batch = await prisma.importBatch.create({
    data: {
      userId,
      fileName,
      institution: parsed.institution,
      accountId: accountByRef.size === 1 ? [...accountByRef.values()][0].id : null,
      rowsParsed: parsed.transactions.length,
      rowsSkipped: parsed.skipped,
      warnings: parsed.warnings,
    },
  });

  try {
    const fingerprints = fingerprintRows(parsed.transactions);
    const accountIds = [...accountByRef.values()].map((a) => a.id);
    const existing = await prisma.transaction.findMany({
      where: { accountId: { in: accountIds }, fingerprint: { in: fingerprints } },
      select: { accountId: true, fingerprint: true },
    });
    const existingSet = new Set(existing.map((e) => `${e.accountId}|${e.fingerprint}`));
    const fresh = parsed.transactions
      .map((tx, i) => ({ tx, fingerprint: fingerprints[i], accountId: accountByRef.get(tx.accountRef)!.id }))
      .filter((r) => !existingSet.has(`${r.accountId}|${r.fingerprint}`));
    const rowsDuplicate = parsed.transactions.length - fresh.length;

    await syncDefaults(userId);
    const [rules, categories] = await Promise.all([
      prisma.categorizationRule.findMany({ where: { userId, isActive: true } }),
      prisma.category.findMany({ where: { userId } }),
    ]);
    const descriptions = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c.description]));
    const bankLabel = parsed.institution === "REVOLUT" ? "Revolut" : "Crédit Agricole";
    const pipelineInput = fresh.map((r) => ({
      rawDescription: r.tx.rawDescription,
      merchantKey: merchantKey(r.tx.rawDescription),
      amountCents: r.tx.amountCents,
      accountId: r.accountId,
      bank: bankLabel,
    }));
    const useAi = aiConfigured();
    const result = await runPipeline(pipelineInput, {
      rules: rules as RuleLike[],
      categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, description: descriptions.get(c.name) ?? c.name })),
      ai: useAi ? categorizeWithAi : undefined,
      describeAiError,
    });
    const warnings = [...parsed.warnings, ...result.warnings];
    if (!useAi && result.stats.byFallback > 0) {
      warnings.push(
        `${result.stats.byFallback} transaction(s) matched no rule and AI is not configured (set ANTHROPIC_API_KEY); they were given a default category and flagged for review.`,
      );
    }

    await prisma.$transaction(
      async (db) => {
        // Persist confident AI decisions as rules so the same merchant is never sent to the model twice.
        for (const r of result.aiRules) {
          await db.categorizationRule.upsert({
            where: {
              userId_field_matchType_pattern_direction: { userId, field: "MERCHANT", matchType: "EXACT", pattern: r.merchantKey, direction: r.direction },
            },
            update: {}, // never overwrite an existing (possibly learned) rule
            create: {
              userId,
              categoryId: r.categoryId,
              field: "MERCHANT",
              matchType: "EXACT",
              pattern: r.merchantKey,
              direction: r.direction,
              source: "AI",
              priority: PRIORITY.AI,
              confidence: r.confidence,
            },
          });
        }
        for (const [ruleId, hits] of result.ruleHits) {
          await db.categorizationRule.update({ where: { id: ruleId }, data: { hitCount: { increment: hits } } });
        }
        if (fresh.length) {
          await db.transaction.createMany({
            data: fresh.map((r, i) => {
              const d = result.decisions[i];
              return {
                userId,
                accountId: r.accountId,
                importBatchId: batch.id,
                date: r.tx.date,
                valueDate: r.tx.valueDate ?? null,
                amountCents: r.tx.amountCents,
                currency: r.tx.currency,
                rawDescription: r.tx.rawDescription,
                merchantKey: pipelineInput[i].merchantKey,
                merchantName: merchantDisplayName(pipelineInput[i].merchantKey, r.tx.rawDescription),
                bankType: r.tx.bankType ?? null,
                categoryId: d.categoryId,
                categorySource: d.source,
                ruleId: d.ruleId,
                confidence: d.confidence,
                needsReview: d.needsReview,
                fingerprint: r.fingerprint,
              };
            }),
            skipDuplicates: true,
          });
        }
        // Only move the balance forward in time; importing an old statement must not rewind it.
        for (const [ref, bal] of Object.entries(parsed.balances)) {
          const account = accountByRef.get(ref);
          if (!account) continue;
          if (!account.balanceAsOf || bal.asOf.getTime() >= account.balanceAsOf.getTime()) {
            await db.account.update({ where: { id: account.id }, data: { balanceCents: bal.cents, balanceAsOf: bal.asOf } });
          }
        }
        await db.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "COMPLETED",
            rowsImported: fresh.length,
            rowsDuplicate,
            byRule: result.stats.byRule,
            byAi: result.stats.byAi,
            byFallback: result.stats.byFallback,
            warnings,
          },
        });
      },
      { timeout: 60_000 },
    );

    return {
      batchId: batch.id,
      fileName,
      institution: parsed.institution,
      accounts: [...accountByRef.values()].map((a) => a.name),
      rowsParsed: parsed.transactions.length,
      rowsImported: fresh.length,
      rowsDuplicate,
      rowsSkipped: parsed.skipped,
      ...result.stats,
      warnings,
    };
  } catch (err) {
    await prisma.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED", error: (err as Error).message } });
    throw err;
  }
}
