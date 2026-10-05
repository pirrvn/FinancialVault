import { Suspense } from "react";
import { getCurrentUser } from "@/lib/services/user";
import { getCategories, getTransactions } from "@/lib/services/queries";
import { prisma } from "@/lib/db";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/app-shell";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  const [transactions, categories, accounts] = await Promise.all([
    getTransactions(user.id),
    getCategories(user.id),
    prisma.account.findMany({ where: { userId: user.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!transactions.length) {
    return (
      <>
        <PageHeader title="Transactions" />
        <EmptyState />
      </>
    );
  }
  return (
    <Suspense>
      <TransactionsView initial={transactions} categories={categories} accounts={accounts} />
    </Suspense>
  );
}
