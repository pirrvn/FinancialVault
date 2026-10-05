import "server-only";
import { prisma } from "../db";
import { PRIORITY } from "../categorization/defaults";
import { compileRules, matchRule, type RuleLike } from "../categorization/rules";
import { fallbackCategory } from "../categorization/pipeline";
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
 * Re-run the rule tier over all non-manual history (after a rule change or a defaults upgrade).
 * - A matching rule (re)assigns its category.
 * - A transaction that was set by a rule which no longer matches (rule deleted, disabled or
 *   edited) goes back to the fallback category and is flagged for review, rather than silently
 *   keeping a stale category.
 * - AI and fallback assignments without a matching rule are left as they are. Manual choices are never touched.
 */
export async function reapplyRules(userId: string): Promise<number> {
  const [rules, categories, txs] = await Promise.all([
    prisma.categorizationRule.findMany({ where: { userId, isActive: true, category: { archived: false } } }),
    prisma.category.findMany({ where: { userId, archived: false }, select: { id: true, kind: true, name: true, systemKey: true } }),
    prisma.transaction.findMany({
      where: { userId, categorySource: { not: "MANUAL" } },
      select: { id: true, rawDescription: true, merchantKey: true, amountCents: true, accountId: true, categoryId: true, ruleId: true, categorySource: true },
    }),
  ]);
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));
  const compiled = compileRules(rules as RuleLike[]);
  const fallbackExpense = fallbackCategory(categories, "EXPENSE");
  const fallbackIncome = fallbackCategory(categories, "INCOME");
  type Update = { categoryId: string; ruleId: string | null; source: CategorySource; confidence: number; needsReview: boolean; ids: string[] };
  const updates = new Map<string, Update>();
  const queue = (key: string, init: Omit<Update, "ids">, id: string) => {
    const entry = updates.get(key) ?? { ...init, ids: [] };
    entry.ids.push(id);
    updates.set(key, entry);
  };
  for (const tx of txs) {
    const rule = matchRule(compiled, tx);
    const kind = rule ? kindById.get(rule.categoryId) : undefined;
    const usable = rule && kind && (kind === "TRANSFER" || tx.amountCents < 0 === (kind === "EXPENSE"));
    if (usable) {
      if (rule.categoryId === tx.categoryId && rule.id === tx.ruleId) continue;
      const confidence = rule.source === "AI" ? (rule.confidence ?? 0.8) : 1;
      queue(`rule:${rule.id}`, { categoryId: rule.categoryId, ruleId: rule.id, source: "RULE", confidence, needsReview: confidence < 0.85 }, tx.id);
    } else if (tx.categorySource === "RULE") {
      const fallback = tx.amountCents < 0 ? fallbackExpense : fallbackIncome;
      if (!fallback) continue;
      queue(`fallback:${fallback.id}`, { categoryId: fallback.id, ruleId: null, source: "FALLBACK", confidence: 0, needsReview: true }, tx.id);
    }
  }
  let changed = 0;
  for (const u of updates.values()) {
    const res = await prisma.transaction.updateMany({
      where: { id: { in: u.ids }, userId },
      data: { categoryId: u.categoryId, ruleId: u.ruleId, categorySource: u.source, confidence: u.confidence, needsReview: u.needsReview },
    });
    changed += res.count;
  }
  return changed;
}

export class NotFoundError extends Error {}
