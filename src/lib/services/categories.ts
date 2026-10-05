import "server-only";
import { prisma } from "../db";
import { PRIORITY, PROTECTED_SYSTEM_KEYS, type Kind } from "../categorization/defaults";
import { runPipeline, type AiRuleToPersist, type PipelineCategory } from "../categorization/pipeline";
import type { RuleLike } from "../categorization/rules";
import { categorizeWithAi, describeAiError } from "../ai/categorize";
import { aiConfigured } from "../ai/client";
import { PALETTE_KEYS } from "../palette";
import type { Prisma } from "@/generated/prisma/client";

export class CategoryError extends Error {}

type Db = Prisma.TransactionClient | typeof prisma;

/** Active rules and visible categories, shaped for the categorization pipeline. */
export async function loadPipelineContext(userId: string, db: Db = prisma) {
  const [rules, categories] = await Promise.all([
    db.categorizationRule.findMany({ where: { userId, isActive: true, category: { archived: false } } }),
    db.category.findMany({ where: { userId, archived: false } }),
  ]);
  const pipelineCategories: PipelineCategory[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description ?? c.name,
    systemKey: c.systemKey,
  }));
  return { rules: rules as RuleLike[], categories: pipelineCategories };
}

/** Persist confident AI decisions as rules so the same merchant is never sent to the model twice. */
export async function persistAiRules(userId: string, aiRules: AiRuleToPersist[], db: Db = prisma) {
  for (const r of aiRules) {
    await db.categorizationRule.upsert({
      where: { userId_field_matchType_pattern_direction: { userId, field: "MERCHANT", matchType: "EXACT", pattern: r.merchantKey, direction: r.direction } },
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
}

export interface CategoryInput {
  name: string;
  kind: Kind;
  color: string;
  icon: string;
  description?: string | null;
}

async function assertNameFree(userId: string, name: string, exceptId?: string) {
  // Case-insensitive, like the category picker: "groceries" next to "Groceries" would be confusing.
  const clash = await prisma.category.findFirst({
    where: { userId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash)
    throw new CategoryError(clash.archived ? `"${clash.name}" is a hidden category. Restore it instead.` : `A category named "${clash.name}" already exists.`);
}

export async function createCategory(userId: string, input: CategoryInput) {
  await assertNameFree(userId, input.name);
  return prisma.category.create({ data: { userId, ...input, description: input.description || null } });
}

/** Quick create from the category picker: a sensible color and icon, refined later in Categories. */
export async function quickCreateCategory(userId: string, name: string, kind: Kind) {
  const used = new Set((await prisma.category.findMany({ where: { userId }, select: { color: true } })).map((c) => c.color));
  const color = PALETTE_KEYS.find((k) => !used.has(k)) ?? PALETTE_KEYS[name.length % PALETTE_KEYS.length];
  return createCategory(userId, { name, kind, color, icon: "Tag", description: null });
}

export async function updateCategory(userId: string, id: string, patch: Partial<CategoryInput>) {
  const category = await prisma.category.findFirst({ where: { id, userId } });
  if (!category) throw new CategoryError("Category not found.");
  if (patch.name && patch.name !== category.name) await assertNameFree(userId, patch.name, id);
  if (patch.kind && patch.kind !== category.kind) {
    // Kind decides which transactions can live here; only an unused custom category may change it.
    if (category.systemKey) throw new CategoryError("The type of a built-in category can't be changed.");
    if (await prisma.transaction.count({ where: { categoryId: id } }))
      throw new CategoryError("Move this category's transactions elsewhere before changing its type.");
  }
  return prisma.category.update({
    where: { id },
    data: { ...patch, ...(patch.description !== undefined ? { description: patch.description || null } : {}) },
  });
}

/**
 * Remove a category. Its transactions and rules move to `targetId` (same type). Built-in
 * categories are hidden rather than deleted, so a future upgrade won't bring them back.
 */
export async function deleteCategory(userId: string, id: string, targetId: string | null) {
  const category = await prisma.category.findFirst({ where: { id, userId } });
  if (!category) throw new CategoryError("Category not found.");
  if (category.systemKey && PROTECTED_SYSTEM_KEYS.has(category.systemKey)) {
    throw new CategoryError(`"${category.name}" is where uncategorized transactions go, so it can't be removed. You can rename it.`);
  }
  const [txCount, ruleCount] = await Promise.all([
    prisma.transaction.count({ where: { categoryId: id } }),
    prisma.categorizationRule.count({ where: { categoryId: id } }),
  ]);
  let target = null;
  if (txCount + ruleCount > 0) {
    if (!targetId) throw new CategoryError("Choose where this category's transactions should go.");
    target = await prisma.category.findFirst({ where: { id: targetId, userId, archived: false, kind: category.kind, NOT: { id } } });
    if (!target) throw new CategoryError("Pick another visible category of the same type.");
  }
  await prisma.$transaction(async (db) => {
    if (target) {
      await db.transaction.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
      await db.categorizationRule.updateMany({ where: { userId, categoryId: id }, data: { categoryId: target.id } });
    }
    if (category.systemKey) await db.category.update({ where: { id }, data: { archived: true } });
    else await db.category.delete({ where: { id } });
  });
  return { moved: txCount, target: target?.name ?? null };
}

export async function restoreCategory(userId: string, id: string) {
  const res = await prisma.category.updateMany({ where: { id, userId, archived: true }, data: { archived: false } });
  if (!res.count) throw new CategoryError("Category not found.");
}

/**
 * Ask the AI again.
 * - "flagged": transactions waiting for review.
 * - "all": every non-manual transaction the rules don't cover. Previous AI decisions don't answer for
 *   the AI, so new or edited categories (e.g. "Bars & Nightlife") get a chance. Your corrections and
 *   rules (including AI rules you edited, which became yours) are kept.
 * Only merchants the AI actually answers for change: their old AI rule is replaced and everything
 * following it moves along. Merchants it leaves unanswered keep their category.
 */
export async function recategorizeWithAi(userId: string, scope: "flagged" | "all") {
  if (!aiConfigured()) throw new CategoryError("AI isn't configured. Add GEMINI_API_KEY in your hosting settings, then redeploy.");
  const txs = await prisma.transaction.findMany({
    where: {
      userId,
      categorySource: { not: "MANUAL" },
      ...(scope === "flagged"
        ? { needsReview: true }
        : {
            OR: [{ categorySource: { in: ["AI", "FALLBACK"] } }, { categorySource: "RULE", ruleId: null }, { categorySource: "RULE", rule: { source: "AI" } }],
          }),
    },
    include: { account: { select: { institution: true } } },
  });
  if (!txs.length) return { updated: 0, byAi: 0, stillFlagged: 0, warnings: [] as string[] };

  const ctx = await loadPipelineContext(userId);
  // Past AI answers are what we re-ask about, so they must not answer in the AI's place.
  // Rules you edited are yours (USER) and still apply.
  ctx.rules = ctx.rules.filter((r) => r.source !== "AI");
  const result = await runPipeline(
    txs.map((t) => ({
      rawDescription: t.rawDescription,
      merchantKey: t.merchantKey,
      amountCents: t.amountCents,
      accountId: t.accountId,
      bank: t.account.institution === "REVOLUT" ? "Revolut" : "Crédit Agricole",
    })),
    { ...ctx, ai: categorizeWithAi, describeAiError },
  );
  // If the AI failed (quota, network…), change nothing rather than downgrade AI choices to "Miscellaneous".
  if (result.warnings.length) throw new CategoryError(result.warnings[0]);

  // Merchants the AI answered for this time; anything it left unanswered keeps its current category and rule.
  const slotOf = (t: { merchantKey: string; amountCents: number }) => `${t.amountCents < 0 ? "DEBIT" : "CREDIT"}|${t.merchantKey}`;
  const answers = new Map<string, (typeof result.decisions)[number]>();
  result.decisions.forEach((d, i) => {
    if (d.source === "AI" && !answers.has(slotOf(txs[i]))) answers.set(slotOf(txs[i]), d);
  });
  const selected = new Set(txs.map((t) => t.id));

  return prisma.$transaction(
    async (db) => {
      const oldAiRules = (await db.categorizationRule.findMany({ where: { userId, source: "AI", field: "MERCHANT", matchType: "EXACT" } })).filter((r) =>
        answers.has(`${r.direction}|${r.pattern}`),
      );
      // Transactions outside this run that still follow an AI rule being replaced get the new answer too.
      const followers = oldAiRules.length
        ? await db.transaction.findMany({
            where: { userId, ruleId: { in: oldAiRules.map((r) => r.id) }, categorySource: { not: "MANUAL" } },
            select: { id: true, merchantKey: true, amountCents: true },
          })
        : [];
      if (oldAiRules.length) await db.categorizationRule.deleteMany({ where: { id: { in: oldAiRules.map((r) => r.id) } } });
      await persistAiRules(userId, result.aiRules, db);

      const groups = new Map<string, { data: (typeof result.decisions)[number]; ids: string[] }>();
      const assign = (id: string, d: (typeof result.decisions)[number]) => {
        const key = `${d.categoryId}|${d.source}|${d.ruleId}|${d.confidence}|${d.needsReview}`;
        const g = groups.get(key) ?? { data: d, ids: [] };
        g.ids.push(id);
        groups.set(key, g);
      };
      result.decisions.forEach((d, i) => {
        if (d.source !== "FALLBACK") assign(txs[i].id, d);
      });
      for (const f of followers) {
        const d = answers.get(slotOf(f));
        if (d && !selected.has(f.id)) assign(f.id, d);
      }
      let updated = 0;
      for (const g of groups.values()) {
        for (let i = 0; i < g.ids.length; i += 5000) {
          const res = await db.transaction.updateMany({
            where: { userId, id: { in: g.ids.slice(i, i + 5000) }, categorySource: { not: "MANUAL" } },
            data: {
              categoryId: g.data.categoryId,
              categorySource: g.data.source,
              ruleId: g.data.ruleId,
              confidence: g.data.confidence,
              needsReview: g.data.needsReview,
            },
          });
          updated += res.count;
        }
      }
      const stillFlagged = result.decisions.filter((d, i) => (d.source === "FALLBACK" ? txs[i].needsReview : d.needsReview)).length;
      return { updated, byAi: result.stats.byAi, stillFlagged, warnings: result.warnings };
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}
