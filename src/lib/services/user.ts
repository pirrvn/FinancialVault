import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { DEFAULT_CATEGORIES, DEFAULTS_VERSION, PRIORITY, SYSTEM_RULES } from "../categorization/defaults";
import { foldText } from "../text";
import { requireSession } from "../auth";
import { reapplyRules } from "./learning";

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
  await reapplyRules(userId);
  await prisma.user.update({ where: { id: userId }, data: { defaultsVersion: DEFAULTS_VERSION } });
}

const ruleIdentity = (r: { matchType: string; pattern: string; direction: string }) => `${r.matchType}|${r.pattern}|${r.direction}`;

/**
 * Sync built-in categories (by systemKey, so user renames are respected) and the SYSTEM rules.
 * - Missing built-in categories are created; a same-named custom category is adopted instead.
 * - Descriptions are filled only where empty, so user edits are kept.
 * - SYSTEM rules are made to match the current lexicon: obsolete ones are deleted, new ones
 *   created, retargeted ones updated (unless their category was archived by the user).
 *   Enabled/disabled state is preserved.
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
  const obsolete = existing.filter((r) => r.field !== "DESCRIPTION" || !desired.has(ruleIdentity(r))).map((r) => r.id);
  if (obsolete.length) await prisma.categorizationRule.deleteMany({ where: { id: { in: obsolete } } });

  for (const r of existing) {
    const want = desired.get(ruleIdentity(r));
    if (want && r.field === "DESCRIPTION" && want.categoryId !== r.categoryId && !want.archived) {
      await prisma.categorizationRule.update({ where: { id: r.id }, data: { categoryId: want.categoryId } });
    }
  }
  const have = new Set(existing.map(ruleIdentity));
  const missing = [...desired.values()].filter((r) => !have.has(ruleIdentity(r)) && !r.archived);
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
      })),
      // A user rule with the same identity already exists; it wins anyway.
      skipDuplicates: true,
    });
  }
}
