import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/services/user";
import { getCategories } from "@/lib/services/queries";
import { RulesView, type RuleDTO } from "@/components/rules/rules-view";

export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const user = await getCurrentUser();
  const [rules, categories] = await Promise.all([
    prisma.categorizationRule.findMany({
      where: { userId: user.id },
      orderBy: [{ priority: "desc" }, { hitCount: "desc" }, { pattern: "asc" }],
      select: {
        id: true,
        categoryId: true,
        field: true,
        matchType: true,
        pattern: true,
        direction: true,
        source: true,
        priority: true,
        confidence: true,
        hitCount: true,
        isActive: true,
      },
    }),
    getCategories(user.id),
  ]);
  return <RulesView rules={rules as RuleDTO[]} categories={categories} />;
}
