import "server-only";
import { prisma } from "../db";
import { PRIORITY } from "../categorization/defaults";
import { compileRules, matchRule, type RuleLike } from "../categorization/rules";
import type { CategorySource } from "@/generated/prisma/client";

/**
 * Tier 3: manual override + learning.
 * Re-categorizing a transaction (a) fixes it, (b) upserts a LEARNED merchant rule that outranks
 * every other rule on future imports, and (c) optionally fixes all similar, non-manual history.
 */
export async function overrideCategory(
  userId: string,
  transactionId: string,
  categoryId: string,
  opts: { applyToSimilar?: boolean; learn?: boolean } = {},
): Promise<{ updatedSimilar: number; ruleId: string | null }> {
  const { applyToSimilar = true, learn = true } = opts;
  const [tx, category] = await Promise.all([
    prisma.transaction.findFirst({ where: { id: transactionId, userId } }),
    prisma.category.findFirst({ where: { id: categoryId, userId } }),
  ]);
  if (!tx) throw new NotFoundError("Transaction not found");
  if (!category) throw new NotFoundError("Category not found");

  const direction = tx.amountCents < 0 ? "DEBIT" : "CREDIT";
  return prisma.$transaction(async (db) => {
    let ruleId: string | null = null;
    if (learn) {
      const rule = await db.categorizationRule.upsert({
        where: { userId_field_matchType_pattern_direction: { userId, field: "MERCHANT", matchType: "EXACT", pattern: tx.merchantKey, direction } },
        update: { categoryId, source: "LEARNED", priority: PRIORITY.LEARNED, confidence: 1, isActive: true },
        create: {
          userId,
          categoryId,
          field: "MERCHANT",
          matchType: "EXACT",
          pattern: tx.merchantKey,
          direction,
          source: "LEARNED",
          priority: PRIORITY.LEARNED,
          confidence: 1,
        },
      });
      ruleId = rule.id;
    }
    await db.transaction.update({
      where: { id: tx.id },
      data: { categoryId, categorySource: "MANUAL", needsReview: false, confidence: 1, ruleId },
    });
    let updatedSimilar = 0;
    if (applyToSimilar) {
      const res = await db.transaction.updateMany({
        where: {
          userId,
          merchantKey: tx.merchantKey,
          id: { not: tx.id },
          categorySource: { not: "MANUAL" },
          amountCents: direction === "DEBIT" ? { lt: 0 } : { gt: 0 },
        },
        data: { categoryId, categorySource: "RULE", needsReview: false, confidence: 1, ruleId },
      });
      updatedSimilar = res.count;
    }
    return { updatedSimilar, ruleId };
  });
}

/** Mark transactions as reviewed without changing their category. */
export async function confirmCategories(userId: string, ids: string[]) {
  const res = await prisma.transaction.updateMany({ where: { userId, id: { in: ids } }, data: { needsReview: false } });
  return res.count;
}

/**
 * Re-run the rule tier over all non-manual history (e.g. after creating or editing a rule).
 * Manual decisions are never touched.
 */
export async function reapplyRules(userId: string): Promise<number> {
  const [rules, categories, txs] = await Promise.all([
    prisma.categorizationRule.findMany({ where: { userId, isActive: true } }),
    prisma.category.findMany({ where: { userId }, select: { id: true, kind: true } }),
    prisma.transaction.findMany({
      where: { userId, categorySource: { not: "MANUAL" } },
      select: { id: true, rawDescription: true, merchantKey: true, amountCents: true, accountId: true, categoryId: true, ruleId: true },
    }),
  ]);
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  const compiled = compileRules(rules as RuleLike[]);
  const updates = new Map<string, { categoryId: string; ruleId: string; confidence: number; ids: string[] }>();
  for (const tx of txs) {
    const rule = matchRule(compiled, tx);
    if (!rule) continue;
    const kind = kindById.get(rule.categoryId);
    if (kind !== "TRANSFER" && tx.amountCents < 0 !== (kind === "EXPENSE")) continue;
    if (rule.categoryId === tx.categoryId && rule.id === tx.ruleId) continue;
    const key = `${rule.id}`;
    const entry = updates.get(key) ?? {
      categoryId: rule.categoryId,
      ruleId: rule.id,
      confidence: rule.source === "AI" ? (rule.confidence ?? 0.8) : 1,
      ids: [],
    };
    entry.ids.push(tx.id);
    updates.set(key, entry);
  }
  let changed = 0;
  for (const u of updates.values()) {
    const res = await prisma.transaction.updateMany({
      where: { id: { in: u.ids }, userId },
      data: {
        categoryId: u.categoryId,
        ruleId: u.ruleId,
        categorySource: "RULE" satisfies CategorySource,
        confidence: u.confidence,
        needsReview: u.confidence < 0.85,
      },
    });
    changed += res.count;
  }
  return changed;
}

export class NotFoundError extends Error {}
