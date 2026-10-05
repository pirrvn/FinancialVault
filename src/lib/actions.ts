"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "./db";
import { getCurrentUser } from "./services/user";
import { confirmCategories, overrideCategory, reapplyRules } from "./services/learning";
import { PRIORITY } from "./categorization/defaults";
import { compileRule } from "./categorization/rules";
import { foldText } from "./text";
import { CategoryError, createCategory, deleteCategory, quickCreateCategory, recategorizeWithAi, restoreCategory, updateCategory } from "./services/categories";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

function revalidateAll() {
  for (const p of ["/", "/transactions", "/insights", "/forecast", "/rules", "/categories"]) revalidatePath(p);
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
  if (data.categoryId && !(await prisma.category.findFirst({ where: { id: data.categoryId, userId: user.id, archived: false } })))
    return { ok: false, error: "Unknown category" };
  const rule = await prisma.categorizationRule.findFirst({ where: { id, userId: user.id } });
  if (!rule) return { ok: false, error: "Rule not found" };
  // An edited built-in or AI rule becomes yours: defaults upgrades and "Re-categorize with AI" leave it alone.
  const source = rule.source === "SYSTEM" || rule.source === "AI" ? "USER" : rule.source;
  await prisma.categorizationRule.update({ where: { id }, data: { ...data, source } });
  revalidateAll();
  return { ok: true, data: undefined };
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  // Built-in rules come back with the next defaults upgrade, so they're switched off instead of deleted.
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

const CategoryFields = {
  name: z.string().trim().min(1, "Give it a name").max(40, "Keep the name under 40 characters"),
  kind: z.enum(["EXPENSE", "INCOME", "TRANSFER"]),
  color: z.string().min(1).max(20),
  icon: z.string().min(1).max(40),
  description: z.string().trim().max(300, "Keep the description under 300 characters").nullable().optional(),
};
const CategorySchema = z.object(CategoryFields);

function categoryError(err: unknown): { ok: false; error: string } {
  if (err instanceof CategoryError) return { ok: false, error: err.message };
  console.error("[categories]", err);
  return { ok: false, error: "Something went wrong." };
}

export async function createCategoryAction(input: z.input<typeof CategorySchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = CategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category" };
  try {
    const user = await getCurrentUser();
    const c = await createCategory(user.id, parsed.data);
    revalidateAll();
    return { ok: true, data: { id: c.id } };
  } catch (err) {
    return categoryError(err);
  }
}

/** Create a category straight from the picker, then the caller assigns it. */
export async function quickCreateCategoryAction(
  name: string,
  kind: "EXPENSE" | "INCOME" | "TRANSFER",
): Promise<ActionResult<{ id: string; name: string; kind: string; color: string; icon: string }>> {
  const parsed = z.object({ name: CategoryFields.name, kind: CategoryFields.kind }).safeParse({ name, kind });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category" };
  try {
    const user = await getCurrentUser();
    const c = await quickCreateCategory(user.id, parsed.data.name, parsed.data.kind);
    revalidateAll();
    return { ok: true, data: { id: c.id, name: c.name, kind: c.kind, color: c.color, icon: c.icon } };
  } catch (err) {
    return categoryError(err);
  }
}

export async function updateCategoryAction(id: string, patch: Partial<z.input<typeof CategorySchema>>): Promise<ActionResult> {
  const parsed = CategorySchema.partial().safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category" };
  try {
    const user = await getCurrentUser();
    await updateCategory(user.id, id, parsed.data);
    revalidateAll();
    return { ok: true, data: undefined };
  } catch (err) {
    return categoryError(err);
  }
}

export async function deleteCategoryAction(id: string, targetId: string | null): Promise<ActionResult<{ moved: number; target: string | null }>> {
  try {
    const user = await getCurrentUser();
    const res = await deleteCategory(user.id, id, targetId);
    revalidateAll();
    return { ok: true, data: res };
  } catch (err) {
    return categoryError(err);
  }
}

export async function restoreCategoryAction(id: string): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    await restoreCategory(user.id, id);
    revalidateAll();
    return { ok: true, data: undefined };
  } catch (err) {
    return categoryError(err);
  }
}

export async function recategorizeWithAiAction(scope: "flagged" | "all"): Promise<ActionResult<{ updated: number; byAi: number; stillFlagged: number }>> {
  if (scope !== "flagged" && scope !== "all") return { ok: false, error: "Invalid request" };
  try {
    const user = await getCurrentUser();
    const res = await recategorizeWithAi(user.id, scope);
    revalidateAll();
    return { ok: true, data: { updated: res.updated, byAi: res.byAi, stillFlagged: res.stillFlagged } };
  } catch (err) {
    return categoryError(err);
  }
}

export async function updateNoteAction(transactionId: string, note: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  const res = await prisma.transaction.updateMany({ where: { id: transactionId, userId: user.id }, data: { note: note.slice(0, 500) || null } });
  if (!res.count) return { ok: false, error: "Transaction not found" };
  revalidatePath("/transactions");
  return { ok: true, data: undefined };
}
