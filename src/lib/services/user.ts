import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { DEFAULT_CATEGORIES, PRIORITY, SYSTEM_RULES } from "../categorization/defaults";
import { foldText } from "../text";
import { requireSession } from "../auth";

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
  await ensureUserSetup(user.id);
  return user;
});

/** Idempotently seed the default categories and the built-in keyword lexicon. */
export async function ensureUserSetup(userId: string) {
  const count = await prisma.category.count({ where: { userId } });
  if (count > 0) return;
  await syncDefaults(userId);
}

/**
 * Add any default categories / built-in lexicon rules the user doesn't have yet (e.g. after an
 * app upgrade extends the lexicon). Never modifies or re-enables existing rows.
 */
export async function syncDefaults(userId: string) {
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ userId, name: c.name, kind: c.kind, color: c.color, icon: c.icon, isSystem: true })),
    skipDuplicates: true,
  });
  const categories = await prisma.category.findMany({ where: { userId } });
  const idByName = new Map(categories.map((c) => [c.name, c.id]));
  await prisma.categorizationRule.createMany({
    data: SYSTEM_RULES.filter((r) => idByName.has(r.category)).map((r) => ({
      userId,
      categoryId: idByName.get(r.category)!,
      field: "DESCRIPTION" as const,
      matchType: "CONTAINS" as const,
      pattern: foldText(r.pattern),
      direction: r.direction ?? "ANY",
      source: "SYSTEM" as const,
      priority: PRIORITY.SYSTEM,
    })),
    skipDuplicates: true,
  });
}
