import "server-only";
import { prisma } from "../db";
import { isoDay } from "../dates";
import { isCardPayment, suggestCategories, type Suggestion } from "../categorization/suggest";
import { getCategories, type CategoryDTO } from "./queries";

export interface ReviewGroup {
  key: string;
  merchantKey: string;
  merchantName: string;
  direction: "DEBIT" | "CREDIT";
  count: number;
  totalCents: number;
  firstDate: string;
  lastDate: string;
  samples: string[];
  accountNames: string[];
  transactionIds: string[];
  currentCategoryId: string;
  suggestions: Suggestion[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * Transactions flagged for review, grouped by merchant and direction: one decision per merchant.
 * Each group comes with local suggestions (no AI) learned from how you filed everything else.
 */
export async function getReviewQueue(userId: string): Promise<{ groups: ReviewGroup[]; categories: CategoryDTO[] }> {
  const [flagged, settled, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId, needsReview: true },
      include: { account: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: { userId, needsReview: false, categorySource: { in: ["MANUAL", "RULE", "AI"] } },
      select: { merchantKey: true, merchantName: true, categoryId: true, amountCents: true, rawDescription: true },
    }),
    getCategories(userId),
  ]);

  // Most common category per already-settled merchant.
  const votes = new Map<string, { name: string; counts: Map<string, number> }>();
  for (const t of settled) {
    const v = votes.get(t.merchantKey) ?? { name: t.merchantName, counts: new Map() };
    v.counts.set(t.categoryId, (v.counts.get(t.categoryId) ?? 0) + 1);
    votes.set(t.merchantKey, v);
  }
  const known = [...votes.entries()].map(([merchantKey, v]) => ({
    merchantKey,
    merchantName: v.name,
    categoryId: [...v.counts.entries()].sort((a, b) => b[1] - a[1])[0][0],
  }));
  const history = settled.map((t) => ({ categoryId: t.categoryId, amountCents: t.amountCents, isCard: isCardPayment(t.rawDescription) }));
  const suggestCats = categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, systemKey: c.systemKey }));

  const groups = new Map<string, (typeof flagged)[number][]>();
  for (const t of flagged) {
    const key = `${t.amountCents < 0 ? "D" : "C"}|${t.merchantKey}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  return {
    categories,
    groups: [...groups.entries()]
      .map(([key, txs]) => {
        const dates = txs.map((t) => isoDay(t.date)).sort();
        const amount = median(txs.map((t) => t.amountCents));
        return {
          key,
          merchantKey: txs[0].merchantKey,
          merchantName: txs[0].merchantName,
          direction: txs[0].amountCents < 0 ? ("DEBIT" as const) : ("CREDIT" as const),
          count: txs.length,
          totalCents: txs.reduce((a, t) => a + t.amountCents, 0),
          firstDate: dates[0],
          lastDate: dates[dates.length - 1],
          samples: [...new Set(txs.map((t) => t.rawDescription))].slice(0, 2),
          accountNames: [...new Set(txs.map((t) => t.account.name))],
          transactionIds: txs.map((t) => t.id),
          currentCategoryId: txs[0].categoryId,
          suggestions: suggestCategories(
            { merchantKey: txs[0].merchantKey, rawDescription: txs[0].rawDescription, amountCents: amount },
            { categories: suggestCats, known, history },
          ),
        };
      })
      .sort((a, b) => b.count - a.count || Math.abs(b.totalCents) - Math.abs(a.totalCents)),
  };
}
