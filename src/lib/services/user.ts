import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { DEFAULT_CATEGORIES, DEFAULTS_VERSION, PRIORITY, SYSTEM_RULES } from "../categorization/defaults";
import { foldText } from "../text";
import { compileRule, normalizeForMatch } from "../categorization/rules";
import { requireSession } from "../auth";
import { reapplyRules } from "./learning";
import { planRekey, type RekeyRule } from "../categorization/rekey";

/**
 * FinanceVault runs single-tenant by default: one owner identified by FINANCEVAULT_USER_EMAIL.
 * Every query is still scoped by userId, so plugging in an auth provider (Auth.js, Clerk…) only
 * requires replacing this function with a session lookup.
 */
export const getCurrentUser = cache(async () => {
  // Every page, API route and server action resolves the user here, so this is the auth gate.
  await requireSession();
  const email = process.env.FINANCEVAULT_USER_EMAIL || "owner@financevault.local";
  const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name: "Owner" } });
  if (user.defaultsVersion < DEFAULTS_VERSION) {
    await upgradeDefaults(user.id);
    user.defaultsVersion = DEFAULTS_VERSION;
  }
  return user;
});

/**
 * Bring a user's built-in categories and lexicon to DEFAULTS_VERSION, then re-run the rules over
 * non-manual history so existing transactions benefit too. Idempotent and safe to run concurrently.
 */
export async function upgradeDefaults(userId: string) {
  await syncDefaults(userId);
  await rekeyMerchants(userId);
  await reapplyRules(userId);
  await prisma.user.update({ where: { id: userId }, data: { defaultsVersion: DEFAULTS_VERSION } });
}

const ruleIdentity = (r: { matchType: string; pattern: string; direction: string }) => `${r.matchType}|${r.pattern}|${r.direction}`;

/**
 * Sync built-in categories (by systemKey, so user renames are respected) and the SYSTEM rules.
 * - Missing built-in categories are created; a same-named custom category is adopted instead.
 * - Descriptions are filled only where empty, so user edits are kept.
 * - SYSTEM rules are made to match the current lexicon: obsolete ones are deleted and new ones
 *   created. The user's choices survive: a built-in rule pointing at another category than the
 *   lexicon says was moved by the user (the lexicon never retargets a rule in place) and becomes
 *   theirs; a rule switched off stays off, including when its lexicon entry was rewritten
 *   ("MONOPRIX" -> "MONOP", "UBER EATS" any direction -> debits only).
 */
export async function syncDefaults(userId: string) {
  let categories = await prisma.category.findMany({ where: { userId } });
  const toCreate: (typeof DEFAULT_CATEGORIES)[number][] = [];
  for (const d of DEFAULT_CATEGORIES) {
    const existing = categories.find((c) => c.systemKey === d.name);
    if (existing) {
      if (!existing.description) await prisma.category.update({ where: { id: existing.id }, data: { description: d.description } });
      continue;
    }
    const sameName = categories.find((c) => c.name === d.name && !c.systemKey && c.kind === d.kind);
    if (sameName) {
      await prisma.category.update({
        where: { id: sameName.id },
        data: { systemKey: d.name, isSystem: true, description: sameName.description ?? d.description },
      });
    } else {
      toCreate.push(d);
    }
  }
  if (toCreate.length) {
    const taken = new Set(categories.map((c) => c.name));
    await prisma.category.createMany({
      data: toCreate.map((d) => ({
        userId,
        // A custom category of another kind may already use the name.
        name: taken.has(d.name) ? `${d.name} (built-in)` : d.name,
        kind: d.kind,
        color: d.color,
        icon: d.icon,
        description: d.description,
        isSystem: true,
        systemKey: d.name,
      })),
      skipDuplicates: true,
    });
  }
  categories = await prisma.category.findMany({ where: { userId } });

  const byKey = new Map(categories.filter((c) => c.systemKey).map((c) => [c.systemKey!, c]));
  const desired = new Map<
    string,
    { matchType: "CONTAINS" | "REGEX"; pattern: string; direction: "ANY" | "DEBIT" | "CREDIT"; categoryId: string; archived: boolean }
  >();
  for (const r of SYSTEM_RULES) {
    const category = byKey.get(r.category);
    if (!category) continue;
    const matchType = r.matchType ?? "CONTAINS";
    const direction: "ANY" | "DEBIT" | "CREDIT" = r.direction ?? "ANY";
    const rule = {
      matchType,
      pattern: matchType === "REGEX" ? r.pattern : foldText(r.pattern),
      direction,
      categoryId: category.id,
      archived: category.archived,
    };
    desired.set(ruleIdentity(rule), rule);
  }

  const existing = await prisma.categorizationRule.findMany({ where: { userId, source: "SYSTEM" } });
  const lexiconCategory = (r: (typeof existing)[number]) => desired.get(ruleIdentity(r))?.categoryId;
  const userMoved = existing.filter((r) => {
    const target = lexiconCategory(r);
    // Moved to a category the lexicon doesn't use for it, or (for retired entries) to a custom category.
    return target ? target !== r.categoryId : !categories.find((c) => c.id === r.categoryId)?.systemKey;
  });
  if (userMoved.length) await prisma.categorizationRule.updateMany({ where: { id: { in: userMoved.map((r) => r.id) } }, data: { source: "USER" } });
  const moved = new Set(userMoved.map((r) => r.id));
  const obsolete = existing.filter((r) => !moved.has(r.id) && (r.field !== "DESCRIPTION" || !desired.has(ruleIdentity(r))));
  if (obsolete.length) await prisma.categorizationRule.deleteMany({ where: { id: { in: obsolete.map((r) => r.id) } } });

  const have = new Set(existing.filter((r) => !obsolete.includes(r)).map(ruleIdentity));
  const missing = [...desired.values()].filter((r) => !have.has(ruleIdentity(r)) && !r.archived);
  // A rewritten entry stays off when the entry it replaces (same category, matching its old keyword) was off.
  const switchedOff = obsolete.filter((r) => !r.isActive);
  const staysOff = (r: (typeof missing)[number]) => {
    if (!switchedOff.length) return false;
    const compiled = compileRule({ ...r, id: "new", field: "DESCRIPTION", accountId: null, priority: 0, source: "SYSTEM" });
    return switchedOff.some(
      (old) => old.categoryId === r.categoryId && [old.pattern, `PRLV ${old.pattern}`].some((text) => compiled?.test(normalizeForMatch(text), foldText(text))),
    );
  };
  if (missing.length) {
    await prisma.categorizationRule.createMany({
      data: missing.map((r) => ({
        userId,
        categoryId: r.categoryId,
        field: "DESCRIPTION" as const,
        matchType: r.matchType,
        pattern: r.pattern,
        direction: r.direction,
        source: "SYSTEM" as const,
        priority: PRIORITY.SYSTEM,
        isActive: !staysOff(r),
      })),
      // A user rule with the same identity already exists; it wins anyway.
      skipDuplicates: true,
    });
  }
}

/**
 * Recompute merchant keys and names with the current normalizer and move merchant rules along
 * (see planRekey). Serialized per user with an advisory lock, and a no-op once keys are current,
 * so two concurrent first page loads can't trip over each other.
 */
export async function rekeyMerchants(userId: string) {
  return prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"rekey:" + userId}))`;
      const [transactions, rules] = await Promise.all([
        db.transaction.findMany({
          where: { userId },
          select: { id: true, rawDescription: true, merchantKey: true, merchantName: true, amountCents: true },
        }),
        db.categorizationRule.findMany({ where: { userId, field: "MERCHANT", matchType: "EXACT" } }),
      ]);
      const plan = planRekey(transactions, rules as RekeyRule[]);

      if (plan.transactions.length) {
        await db.$executeRaw`
          UPDATE "Transaction" AS t SET "merchantKey" = v.key, "merchantName" = v.name, "updatedAt" = NOW()
          FROM unnest(${plan.transactions.map((t) => t.id)}::text[], ${plan.transactions.map((t) => t.merchantKey)}::text[], ${plan.transactions.map((t) => t.merchantName)}::text[]) AS v(id, key, name)
          WHERE t.id = v.id AND t."userId" = ${userId}`;
      }
      if (plan.deleteRules.length) await db.categorizationRule.deleteMany({ where: { id: { in: plan.deleteRules } } });
      // Two steps so a rule can take a key another rule is leaving in the same pass.
      for (const r of plan.updateRules) await db.categorizationRule.update({ where: { id: r.id }, data: { pattern: `~rekey~${r.id}` } });
      for (const r of plan.updateRules) await db.categorizationRule.update({ where: { id: r.id }, data: { pattern: r.pattern } });
      if (plan.copyRules.length) {
        const byId = new Map(rules.map((r) => [r.id, r]));
        await db.categorizationRule.createMany({
          data: plan.copyRules.map(({ fromId, pattern }) => {
            const r = byId.get(fromId)!;
            return {
              userId,
              categoryId: r.categoryId,
              field: r.field,
              matchType: r.matchType,
              pattern,
              direction: r.direction,
              accountId: r.accountId,
              source: r.source,
              priority: r.priority,
              confidence: r.confidence,
              isActive: r.isActive,
            };
          }),
        });
      }
      return plan;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}
