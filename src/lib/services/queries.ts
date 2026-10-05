import "server-only";
import { prisma } from "../db";
import { isoDay } from "../dates";
import type { AccountBalance, AnalyticsTx } from "../analytics/types";

export interface CategoryDTO {
  id: string;
  name: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  color: string;
  icon: string;
  isSystem: boolean;
  description: string | null;
  systemKey: string | null;
  archived: boolean;
}

export interface TransactionDTO extends AnalyticsTx {
  rawDescription: string;
  accountName: string;
  institution: string;
  categorySource: "RULE" | "AI" | "MANUAL" | "FALLBACK";
  confidence: number | null;
  needsReview: boolean;
  note: string | null;
}

/** Visible categories (pickers, filters). Pass includeArchived for the Categories screen. */
export async function getCategories(userId: string, opts: { includeArchived?: boolean } = {}): Promise<CategoryDTO[]> {
  const cats = await prisma.category.findMany({
    where: { userId, ...(opts.includeArchived ? {} : { archived: false }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    color: c.color,
    icon: c.icon,
    isSystem: c.isSystem,
    description: c.description,
    systemKey: c.systemKey,
    archived: c.archived,
  }));
}

export async function getTransactions(userId: string, opts: { since?: Date } = {}): Promise<TransactionDTO[]> {
  const rows = await prisma.transaction.findMany({
    where: { userId, ...(opts.since ? { date: { gte: opts.since } } : {}) },
    include: { category: true, account: true },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map((t) => ({
    id: t.id,
    date: isoDay(t.date),
    amountCents: t.amountCents,
    currency: t.currency,
    merchantKey: t.merchantKey,
    merchantName: t.merchantName,
    categoryId: t.categoryId,
    categoryName: t.category.name,
    kind: t.category.kind,
    accountId: t.accountId,
    rawDescription: t.rawDescription,
    accountName: t.account.name,
    institution: t.account.institution,
    categorySource: t.categorySource,
    confidence: t.confidence,
    needsReview: t.needsReview,
    note: t.note,
  }));
}

/**
 * Current balance per account. When a statement reported a balance we roll it forward with
 * any later transactions; otherwise the balance is the plain sum of imported flows.
 */
export async function getAccountBalances(userId: string): Promise<AccountBalance[]> {
  const accounts = await prisma.account.findMany({ where: { userId }, orderBy: { name: "asc" } });
  const result: AccountBalance[] = [];
  for (const a of accounts) {
    if (a.balanceCents !== null && a.balanceAsOf) {
      const after = await prisma.transaction.aggregate({ where: { accountId: a.id, date: { gt: a.balanceAsOf } }, _sum: { amountCents: true } });
      result.push({
        id: a.id,
        name: a.name,
        institution: a.institution,
        currency: a.currency,
        balanceCents: a.balanceCents + (after._sum.amountCents ?? 0),
        reported: true,
      });
    } else {
      const all = await prisma.transaction.aggregate({ where: { accountId: a.id }, _sum: { amountCents: true } });
      result.push({ id: a.id, name: a.name, institution: a.institution, currency: a.currency, balanceCents: all._sum.amountCents ?? 0, reported: false });
    }
  }
  return result;
}

export async function getWorkspace(userId: string) {
  const [transactions, accounts, categories] = await Promise.all([getTransactions(userId), getAccountBalances(userId), getCategories(userId)]);
  return { transactions, accounts, categories };
}
