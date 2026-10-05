import { getCurrentUser } from "@/lib/services/user";
import { getCategories, getTransactions } from "@/lib/services/queries";
import { InsightsView } from "@/components/insights/insights-view";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/app-shell";

export const metadata = { title: "Insights" };

export default async function InsightsPage() {
  const user = await getCurrentUser();
  const [transactions, categories] = await Promise.all([getTransactions(user.id), getCategories(user.id)]);
  if (!transactions.length) {
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState />
      </>
    );
  }
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
  return <InsightsView txs={txs} categories={categories} currency={user.baseCurrency} />;
}
