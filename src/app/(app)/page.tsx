import { getCurrentUser } from "@/lib/services/user";
import { getWorkspace } from "@/lib/services/queries";
import { Dashboard } from "@/components/dashboard/dashboard";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/app-shell";

export default async function OverviewPage() {
  const user = await getCurrentUser();
  const { transactions, accounts, categories } = await getWorkspace(user.id);
  if (!transactions.length) {
    return (
      <>
        <PageHeader title="Welcome to FinanceVault" subtitle="Your private financial command center." />
        <EmptyState />
      </>
    );
  }
  const reviewCount = transactions.filter((t) => t.needsReview).length;
  // Only ship the fields the client analytics need.
  const txs = transactions.map(({ id, date, amountCents, currency, merchantKey, merchantName, categoryId, categoryName, kind, accountId }) => ({
    id,
    date,
    amountCents,
    currency,
    merchantKey,
    merchantName,
    categoryId,
    categoryName,
    kind,
    accountId,
  }));
  return <Dashboard txs={txs} accounts={accounts} categories={categories} currency={user.baseCurrency} reviewCount={reviewCount} />;
}
