"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./db";
import { getCurrentUser } from "./services/user";
import { confirmCategories, overrideCategory, reapplyRules } from "./services/learning";
import { PRIORITY } from "./categorization/defaults";
import { compileRule } from "./categorization/rules";
import { foldText } from "./text";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function revalidateAll() {
  for (const p of ["/", "/transactions", "/insights", "/forecast", "/rules"]) revalidatePath(p);
}

const OverrideSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
  applyToSimilar: z.boolean().default(true),
  learn: z.boolean().default(true),
});

/** One-click manual fix. Also saves a permanent LEARNED rule for the merchant. */
export async function overrideCategoryAction(input: z.input<typeof OverrideSchema>): Promise<ActionResult<{ updatedSimilar: number }>> {
  const parsed = OverrideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  try {
    const user = await getCurrentUser();
    const res = await overrideCategory(user.id, parsed.data.transactionId, parsed.data.categoryId, parsed.data);
    revalidateAll();
    return { ok: true, data: { updatedSimilar: res.updatedSimilar } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function confirmReviewAction(ids: string[]): Promise<ActionResult<{ count: number }>> {
  const parsed = z.array(z.string()).max(5000).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const user = await getCurrentUser();
  const count = await confirmCategories(user.id, parsed.data);
  revalidateAll();
  return { ok: true, data: { count } };
}

const RuleSchema = z.object({
  categoryId: z.string().min(1),
  field: z.enum(["MERCHANT", "DESCRIPTION"]),
  matchType: z.enum(["CONTAINS", "STARTS_WITH", "EXACT", "REGEX"]),
  pattern: z.string().trim().min(1).max(300),
  direction: z.enum(["ANY", "DEBIT", "CREDIT"]),
  applyToExisting: z.boolean().default(true),
});

export async function createRuleAction(input: z.input<typeof RuleSchema>): Promise<ActionResult<{ reapplied: number }>> {
  const parsed = RuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  const user = await getCurrentUser();
  const d = parsed.data;
  const pattern = d.matchType === "REGEX" ? d.pattern : foldText(d.pattern);
  if (
    !compileRule({
      id: "probe",
      categoryId: d.categoryId,
      field: d.field,
      matchType: d.matchType,
      pattern,
      direction: d.direction,
      accountId: null,
      priority: 0,
      source: "USER",
    })
  ) {
    return { ok: false, error: "That regular expression is not valid." };
  }
  const category = await prisma.category.findFirst({ where: { id: d.categoryId, userId: user.id } });
  if (!category) return { ok: false, error: "Unknown category" };
  await prisma.categorizationRule.upsert({
    where: { userId_field_matchType_pattern_direction: { userId: user.id, field: d.field, matchType: d.matchType, pattern, direction: d.direction } },
    update: { categoryId: d.categoryId, source: "USER", priority: PRIORITY.USER, isActive: true },
    create: {
      userId: user.id,
      categoryId: d.categoryId,
      field: d.field,
      matchType: d.matchType,
      pattern,
      direction: d.direction,
      source: "USER",
      priority: PRIORITY.USER,
    },
  });
  const reapplied = d.applyToExisting ? await reapplyRules(user.id) : 0;
  revalidateAll();
  return { ok: true, data: { reapplied } };
}

export async function updateRuleAction(id: string, patch: { isActive?: boolean; categoryId?: string; priority?: number }): Promise<ActionResult> {
  const user = await getCurrentUser();
  const data = z
    .object({ isActive: z.boolean().optional(), categoryId: z.string().optional(), priority: z.number().int().min(0).max(5000).optional() })
    .parse(patch);
  if (data.categoryId && !(await prisma.category.findFirst({ where: { id: data.categoryId, userId: user.id } })))
    return { ok: false, error: "Unknown category" };
  const res = await prisma.categorizationRule.updateMany({ where: { id, userId: user.id }, data });
  if (!res.count) return { ok: false, error: "Rule not found" };
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  // Built-in rules are re-synced on import, so they're disabled instead of deleted.
  const res = await prisma.categorizationRule.deleteMany({ where: { id, userId: user.id, source: { not: "SYSTEM" } } });
  if (!res.count) return { ok: false, error: "Rule not found" };
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function reapplyRulesAction(): Promise<ActionResult<{ changed: number }>> {
  const user = await getCurrentUser();
  const changed = await reapplyRules(user.id);
  revalidateAll();
  return { ok: true, data: { changed } };
}

const CategorySchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  color: z.string().min(1).max(20),
  icon: z.string().min(1).max(40),
});

export async function createCategoryAction(input: z.input<typeof CategorySchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = CategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid category" };
  const user = await getCurrentUser();
  const exists = await prisma.category.findFirst({ where: { userId: user.id, name: parsed.data.name } });
  if (exists) return { ok: false, error: "A category with that name already exists" };
  const c = await prisma.category.create({ data: { ...parsed.data, userId: user.id } });
  revalidateAll();
  return { ok: true, data: { id: c.id } };
}

export async function updateNoteAction(transactionId: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const res = await prisma.transaction.updateMany({ where: { id: transactionId, userId: user.id }, data: { note: note.slice(0, 500) || null } });
  if (!res.count) return { ok: false, error: "Transaction not found" };
  revalidatePath("/transactions");
  return { ok: true, data: undefined };
}
