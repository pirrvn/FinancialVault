"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, ChevronRight, Repeat } from "lucide-react";
import type { AccountBalance, AnalyticsTx } from "@/lib/analytics/types";
import type { CategoryDTO } from "@/lib/services/queries";
import { balanceCurve, categoryBreakdown, computeKpis, monthlySeries } from "@/lib/analytics/summary";
import { detectRecurring } from "@/lib/analytics/recurring";
import { merchantConcentration } from "@/lib/analytics/concentration";
import { formatMoney, formatPercent } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import { Card, CardHeader } from "../ui/card";
import { Select } from "../ui/input";
import { KpiCard } from "./kpi-card";
import { CashflowChart } from "../charts/cashflow-chart";
import { BalanceChart } from "../charts/balance-chart";
import { BarList } from "../charts/bar-list";
import { CategoryIcon } from "../category-icon";
import { PageHeader } from "../app-shell";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Dashboard({
  txs,
  accounts,
  categories,
  currency,
  reviewCount,
}: {
  txs: AnalyticsTx[];
  accounts: AccountBalance[];
  categories: CategoryDTO[];
  currency: string;
  reviewCount: number;
}) {
  const router = useRouter();
  const base = React.useMemo(() => txs.filter((t) => t.currency === currency), [txs, currency]);
  const series = React.useMemo(() => monthlySeries(base), [base]);
  const months = series.map((s) => s.month);
  const [focus, setFocus] = React.useState(months.at(-1) ?? "");
  const kpis = React.useMemo(() => computeKpis(base, accounts, currency, focus), [base, accounts, currency, focus]);
  const focusTxs = React.useMemo(() => base.filter((t) => t.date.startsWith(focus)), [base, focus]);
  const breakdown = React.useMemo(() => categoryBreakdown(focusTxs), [focusTxs]);
  const curve = React.useMemo(() => balanceCurve(base, kpis.netWorthCents, currency), [base, kpis.netWorthCents, currency]);
  const merchants = React.useMemo(() => merchantConcentration(focusTxs).merchants.slice(0, 6), [focusTxs]);
  const upcoming = React.useMemo(
    () =>
      detectRecurring(base)
        .filter((r) => r.active)
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
        .slice(0, 6),
    [base],
  );
  const catById = new Map(categories.map((c) => [c.id, c]));
  const otherCurrencies = [...new Set(accounts.map((a) => a.currency))].filter((c) => c !== currency);

  const pct = (cur: number, prev: number) => (prev ? (cur - prev) / Math.abs(prev) : null);
  const cashDelta = kpis.cashFlowCents - kpis.cashFlowPrevCents;
  const burnDelta = pct(kpis.burnRateCents, kpis.burnRatePrevCents);
  const rateDelta = kpis.savingsRate - kpis.savingsRatePrev;

  return (
    <>
      <PageHeader
        title={greeting()}
        subtitle={`Here's where your money stands for ${monthLabel(focus, "long")}.`}
        actions={
          <Select value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Month">
            {[...months].reverse().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, "long")}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Net worth"
          value={formatMoney(kpis.netWorthCents, currency, { decimals: false })}
          delta={kpis.netWorthChangeCents}
          deltaLabel={formatMoney(kpis.netWorthChangeCents, currency, { sign: true, decimals: false })}
          footnote={`in ${monthLabel(focus)}`}
        />
        <KpiCard
          label="Cash flow"
          value={formatMoney(kpis.cashFlowCents, currency, { sign: true, decimals: false })}
          delta={cashDelta}
          deltaLabel={formatMoney(cashDelta, currency, { sign: true, decimals: false })}
          footnote="vs last month"
        />
        <KpiCard
          label="Savings rate"
          value={formatPercent(kpis.savingsRate)}
          delta={rateDelta}
          deltaLabel={`${rateDelta >= 0 ? "+" : ""}${(rateDelta * 100).toFixed(1)} pts`}
          footnote="3-month average"
        />
        <KpiCard
          label="Burn rate"
          value={formatMoney(kpis.burnRateCents, currency, { decimals: false })}
          delta={burnDelta}
          goodWhenUp={false}
          deltaLabel={burnDelta === null ? undefined : formatPercent(Math.abs(burnDelta), 1)}
          footnote={Number.isFinite(kpis.runwayMonths) && kpis.runwayMonths > 0 ? `${kpis.runwayMonths.toFixed(1)} months runway` : "per month"}
        />
      </div>

      {reviewCount > 0 && (
        <Link
          href="/review"
          className="mt-4 flex animate-rise items-center gap-3 rounded-2xl bg-[color-mix(in_srgb,var(--warning)_9%,var(--surface))] px-5 py-3.5 text-[14px] transition hover:brightness-[0.98]"
        >
          <CircleAlert className="size-4 text-warning" />
          <span className="flex-1">
            <span className="font-medium">
              {reviewCount} transaction{reviewCount > 1 ? "s" : ""} to review.
            </span>{" "}
            <span className="text-muted">One tap per merchant. FinanceVault remembers your answer for every future statement.</span>
          </span>
          <ChevronRight className="size-4 text-subtle" />
        </Link>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Cash flow" subtitle="Income and expenses by month. Transfers between your accounts are excluded." />
          <div className="px-4 pt-4 pb-4 sm:px-6">
            <CashflowChart data={series.slice(-12)} currency={currency} focusMonth={focus} onSelectMonth={setFocus} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Spending"
            subtitle={`${monthLabel(focus, "long")} · ${formatMoney(
              breakdown.reduce((a, s) => a + s.totalCents, 0),
              currency,
              { decimals: false },
            )}`}
          />
          <div className="px-4 pt-3 pb-4">
            {breakdown.length ? (
              <BarList
                currency={currency}
                items={breakdown.slice(0, 6).map((s) => {
                  const c = catById.get(s.categoryId);
                  return {
                    key: s.categoryId,
                    label: s.categoryName,
                    valueCents: s.totalCents,
                    share: s.share,
                    leading: c ? <CategoryIcon icon={c.icon} color={c.color} size="md" /> : null,
                    onClick: () => router.push(`/transactions?category=${s.categoryId}&month=${focus}`),
                  };
                })}
              />
            ) : (
              <p className="px-2 py-8 text-center text-sm text-muted">No spending this month.</p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Balance"
            subtitle={`Combined ${currency} balance across ${accounts.filter((a) => a.currency === currency).length} account(s)${otherCurrencies.length ? ` · ${otherCurrencies.join(", ")} accounts shown separately` : ""}`}
          />
          <div className="px-4 pt-4 pb-2 sm:px-6">
            <BalanceChart data={curve} currency={currency} />
          </div>
          <div className="mx-6 mb-5 grid grid-cols-1 gap-x-6 border-t border-line pt-3 sm:grid-cols-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-baseline justify-between py-1.5 text-[13px]">
                <span className="truncate pr-3 text-muted">
                  {a.name}
                  {!a.reported && (
                    <span className="text-subtle" title="No statement balance found; computed from imported transactions">
                      {" "}
                      · est.
                    </span>
                  )}
                </span>
                <span className="tabular font-medium">{formatMoney(a.balanceCents, a.currency)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Upcoming charges"
            subtitle="Detected recurring payments"
            action={
              <Link href="/insights" className="text-[13px] font-medium text-accent">
                All
              </Link>
            }
          />
          <ul className="px-4 pt-3 pb-4">
            {upcoming.length ? (
              upcoming.map((r) => {
                const c = catById.get(r.categoryId);
                return (
                  <li key={r.merchantKey} className="flex items-center gap-3 rounded-xl px-2 py-2">
                    {c ? <CategoryIcon icon={c.icon} color={c.color} /> : <Repeat className="size-4" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{r.merchantName}</span>
                      <span className="block text-[12px] text-subtle">
                        {new Date(r.nextDate + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · {r.cadence}
                      </span>
                    </span>
                    <span className="tabular text-[13.5px]">{formatMoney(r.amountCents, currency)}</span>
                  </li>
                );
              })
            ) : (
              <li className="px-2 py-6 text-center text-sm text-muted">Need at least two months of data.</li>
            )}
          </ul>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader title="Top merchants" subtitle={monthLabel(focus, "long")} />
        <div className="grid grid-cols-1 gap-x-8 px-4 pt-3 pb-4 md:grid-cols-2">
          <BarList
            currency={currency}
            barClassName="bg-fg/25"
            max={merchants[0]?.totalCents}
            items={merchants
              .slice(0, 3)
              .map((m) => ({ key: m.merchantKey, label: m.merchantName, valueCents: m.totalCents, share: m.share, meta: `${m.count}× · ${m.categoryName}` }))}
          />
          <BarList
            currency={currency}
            barClassName="bg-fg/25"
            max={merchants[0]?.totalCents}
            items={merchants
              .slice(3, 6)
              .map((m) => ({ key: m.merchantKey, label: m.merchantName, valueCents: m.totalCents, share: m.share, meta: `${m.count}× · ${m.categoryName}` }))}
          />
        </div>
      </Card>
    </>
  );
}
