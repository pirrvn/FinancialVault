import { getCurrentUser } from "@/lib/services/user";
import { getAccountBalances, getTransactions } from "@/lib/services/queries";
import { detectRecurring } from "@/lib/analytics/recurring";
import { buildBaseline } from "@/lib/analytics/forecast";
import { balanceCurve } from "@/lib/analytics/summary";
import { ForecastView } from "@/components/forecast/forecast-view";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/app-shell";

export const metadata = { title: "Forecast" };

export default async function ForecastPage() {
  const user = await getCurrentUser();
  const [transactions, accounts] = await Promise.all([getTransactions(user.id), getAccountBalances(user.id)]);
  const currency = user.baseCurrency;
  const txs = transactions.filter((t) => t.currency === currency);
  if (!txs.length) {
    return (
      <>
        <PageHeader title="Forecast" />
        <EmptyState />
      </>
    );
  }
  const netWorth = accounts.filter((a) => a.currency === currency).reduce((a, x) => a + x.balanceCents, 0);
  const baseline = buildBaseline({
    txs,
    recurringExpenses: detectRecurring(txs),
    recurringIncome: detectRecurring(txs, { direction: "CREDIT" }),
    startBalanceCents: netWorth,
  });
  // Month-end actual balances for the last 6 months, to draw history before the projection.
  const curve = balanceCurve(txs, netWorth, currency, 6);
  const monthEnd = new Map<string, number>();
  for (const p of curve) monthEnd.set(p.date.slice(0, 7), p.balanceCents);
  const history = [...monthEnd.entries()].map(([month, balanceCents]) => ({ month, balanceCents }));
  return <ForecastView baseline={baseline} history={history} currency={currency} />;
}
