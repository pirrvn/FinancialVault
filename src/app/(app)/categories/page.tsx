import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/services/user";
import { getCategories } from "@/lib/services/queries";
import { aiConfigured } from "@/lib/ai/client";
import { PROTECTED_SYSTEM_KEYS } from "@/lib/categorization/defaults";
import { CategoriesView } from "@/components/categories/categories-view";

export const metadata = { title: "Categories" };
// Re-categorizing with AI can take a while on a large history.
export const maxDuration = 300;

export default async function CategoriesPage() {
  const user = await getCurrentUser();
  const [categories, txCounts, ruleCounts, reviewCount] = await Promise.all([
    getCategories(user.id, { includeArchived: true }),
    prisma.transaction.groupBy({ by: ["categoryId"], where: { userId: user.id }, _count: { _all: true } }),
    prisma.categorizationRule.groupBy({ by: ["categoryId"], where: { userId: user.id }, _count: { _all: true } }),
    prisma.transaction.count({ where: { userId: user.id, needsReview: true } }),
  ]);
  const tx = new Map(txCounts.map((r) => [r.categoryId, r._count._all]));
  const rules = new Map(ruleCounts.map((r) => [r.categoryId, r._count._all]));
  const withStats = categories.map((c) => ({
    ...c,
    transactionCount: tx.get(c.id) ?? 0,
    ruleCount: rules.get(c.id) ?? 0,
    isProtected: !!c.systemKey && PROTECTED_SYSTEM_KEYS.has(c.systemKey),
  }));
  return <CategoriesView categories={withStats} aiEnabled={aiConfigured()} reviewCount={reviewCount} />;
}
