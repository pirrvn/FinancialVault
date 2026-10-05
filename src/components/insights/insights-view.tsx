"use client";

import * as React from "react";
import { TrendingUp, Layers, Receipt, Store, Sparkles, CircleSlash, Repeat, AlertTriangle, Lightbulb, Info } from "lucide-react";
import type { AnalyticsTx } from "@/lib/analytics/types";
import type { CategoryDTO } from "@/lib/services/queries";
import { detectRecurring, type RecurringSeries } from "@/lib/analytics/recurring";
import { merchantConcentration } from "@/lib/analytics/concentration";
import { findOpportunities, type Opportunity } from "@/lib/analytics/opportunities";
import { monthlySeries } from "@/lib/analytics/summary";
import { formatMoney, formatPercent } from "@/lib/money";
import { addMonths } from "@/lib/dates";
import { Card, CardHeader } from "../ui/card";
import { Segmented } from "../ui/segmented";
import { BarList } from "../charts/bar-list";
import { CategoryIcon } from "../category-icon";
import { PageHeader } from "../app-shell";
import { useCopilot } from "../copilot/copilot-provider";
import { cn } from "@/lib/utils";

const OPP_ICON: Record<Opportunity["kind"], React.ComponentType<{ className?: string }>> = {
  "subscription-overlap": Layers,
  "price-increase": TrendingUp,
  "category-spike": AlertTriangle,
  fees: Receipt,
  concentration: Store,
  "inactive-subscription": CircleSlash,
  "subscription-load": Repeat,
};

export function InsightsView({ txs, categories, currency }: { txs: AnalyticsTx[]; categories: CategoryDTO[]; currency: string }) {
  const copilot = useCopilot();
  const base = React.useMemo(() => txs.filter((t) => t.currency === currency), [txs, currency]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const subs = React.useMemo(() => detectRecurring(base), [base]);
  const income = React.useMemo(() => detectRecurring(base, { direction: "CREDIT" }), [base]);
  const [range, setRange] = React.useState<1 | 3 | 12>(3);
  const lastDate =
    base
      .map((t) => t.date)
      .sort()
      .at(-1) ?? new Date().toISOString().slice(0, 10);
  const since = addMonths(new Date(lastDate.slice(0, 7) + "-01T00:00:00Z"), -(range - 1))
    .toISOString()
    .slice(0, 10);
  const concentration = React.useMemo(() => merchantConcentration(base.filter((t) => t.date >= since)), [base, since]);
  const focusMonth = monthlySeries(base).at(-1)?.month ?? lastDate.slice(0, 7);
  const recentConcentration = React.useMemo(() => {
    const threeMonthsAgo = addMonths(new Date(lastDate + "T00:00:00Z"), -3)
      .toISOString()
      .slice(0, 10);
    return merchantConcentration(base.filter((t) => t.date >= threeMonthsAgo));
  }, [base, lastDate]);
  const opportunities = React.useMemo(
    () => findOpportunities({ txs: base, subscriptions: subs, concentration: recentConcentration, focusMonth, currency }),
    [base, subs, recentConcentration, focusMonth, currency],
  );
  const active = subs.filter((s) => s.active);
  const inactive = subs.filter((s) => !s.active);
  const monthlyCommitted = active.reduce((a, s) => a + s.monthlyCents, 0);
  const potential = opportunities.reduce((a, o) => a + o.annualSavingsCents, 0);

  return (
    <>
      <PageHeader title="Insights" subtitle="Subscriptions, spending concentration, and where you could save." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Recurring commitments" value={formatMoney(monthlyCommitted, currency, { decimals: false })} note={`per month · ${active.length} active`} />
        <Stat label="Yearly cost" value={formatMoney(monthlyCommitted * 12, currency, { decimals: false })} note="if nothing changes" />
        <Stat label="Potential savings" value={formatMoney(potential, currency, { decimals: false })} note="per year, estimated" accent />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Subscriptions & bills" subtitle="Detected from regular intervals and stable amounts" />
          <ul className="mt-2 divide-y divide-line px-3 pb-3">
            {active.length === 0 && <li className="px-3 py-10 text-center text-sm text-muted">Import at least two months to detect recurring charges.</li>}
            {active.map((s) => (
              <SubRow key={s.merchantKey} s={s} category={catById.get(s.categoryId)} currency={currency} />
            ))}
          </ul>
          {inactive.length > 0 && (
            <details className="group border-t border-line px-6 py-3">
              <summary className="cursor-pointer text-[13px] font-medium text-muted">{inactive.length} stopped</summary>
              <ul className="mt-1 divide-y divide-line">
                {inactive.map((s) => (
                  <SubRow key={s.merchantKey} s={s} category={catById.get(s.categoryId)} currency={currency} muted />
                ))}
              </ul>
            </details>
          )}
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card>
            <CardHeader title="Savings opportunities" subtitle="Ranked by estimated yearly impact" />
            <ul className="space-y-2 p-4">
              {opportunities.length === 0 && <li className="py-8 text-center text-sm text-muted">Nothing stands out. Your spending looks tidy.</li>}
              {opportunities.map((o) => {
                const Icon = OPP_ICON[o.kind] ?? Lightbulb;
                return (
                  <li key={o.id} className="rounded-2xl bg-fill p-3.5">
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                          o.severity === "warning" ? "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning" : "bg-surface text-muted",
                        )}
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline justify-between gap-2 text-[13.5px] font-medium">
                          <span>{o.title}</span>
                          {o.annualSavingsCents > 0 && (
                            <span className="shrink-0 tabular text-[12.5px] text-positive">
                              {formatMoney(o.annualSavingsCents, currency, { decimals: false })}/yr
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{o.detail}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="px-4 pb-4">
              {copilot.enabled && (
                <button
                  onClick={() =>
                    copilot.ask("Look at my subscriptions and savings opportunities. What are the three changes that would save me the most per year, and how?")
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-fill py-2.5 text-[13px] font-medium transition-colors hover:bg-fill-strong"
                >
                  <Sparkles className="size-3.5 text-accent" /> Build a savings plan with Copilot
                </button>
              )}
            </div>
          </Card>
          {income.length > 0 && (
            <Card>
              <CardHeader title="Recurring income" />
              <ul className="px-4 pt-2 pb-4">
                {income.map((s) => (
                  <li key={s.merchantKey} className="flex items-center justify-between px-2 py-1.5 text-[13.5px]">
                    <span className="truncate">
                      {s.merchantName} <span className="text-[12px] text-subtle">· {s.cadence}</span>
                    </span>
                    <span className="tabular font-medium text-positive">{formatMoney(s.amountCents, currency, { decimals: false })}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Merchant concentration"
          subtitle={
            <span className="inline-flex items-center gap-1.5">
              Top 3 merchants take {formatPercent(concentration.top3Share)} of spending · concentration is{" "}
              <span className="font-medium text-fg">{concentration.level}</span>
              <span title="Herfindahl–Hirschman index over merchant shares. Above 0.25 means a few merchants dominate your spending.">
                <Info className="size-3.5" />
              </span>
            </span>
          }
          action={
            <Segmented
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { value: 1, label: "1M" },
                { value: 3, label: "3M" },
                { value: 12, label: "12M" },
              ]}
            />
          }
        />
        <div className="grid grid-cols-1 gap-x-8 px-4 pt-4 pb-4 md:grid-cols-2">
          <BarList
            currency={currency}
            max={concentration.merchants[0]?.totalCents}
            items={concentration.merchants
              .slice(0, 6)
              .map((m) => ({ key: m.merchantKey, label: m.merchantName, valueCents: m.totalCents, share: m.share, meta: `${m.count}× · ${m.categoryName}` }))}
          />
          <BarList
            currency={currency}
            max={concentration.merchants[0]?.totalCents}
            items={concentration.merchants
              .slice(6, 12)
              .map((m) => ({ key: m.merchantKey, label: m.merchantName, valueCents: m.totalCents, share: m.share, meta: `${m.count}× · ${m.categoryName}` }))}
          />
        </div>
      </Card>
    </>
  );
}

function Stat({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className="animate-rise rounded-3xl bg-surface p-5 shadow-card">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={cn("mt-2 tabular text-[28px] leading-none font-semibold tracking-[-0.025em]", accent && "text-positive")}>{value}</p>
      <p className="mt-3 text-[12.5px] text-subtle">{note}</p>
    </div>
  );
}

function SubRow({ s, category, currency, muted }: { s: RecurringSeries; category?: CategoryDTO; currency: string; muted?: boolean }) {
  const date = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <li className={cn("flex items-center gap-3 px-3 py-3", muted && "opacity-60")}>
      {category && <CategoryIcon icon={category.icon} color={category.color} />}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[14px] font-medium">
          {s.merchantName}
          {s.priceIncrease && (
            <span className="rounded-full bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 text-[10.5px] font-semibold text-warning">PRICE ↑</span>
          )}
          {!s.amountStable && <span className="rounded-full bg-fill px-1.5 text-[10.5px] font-medium text-muted">VARIABLE</span>}
        </p>
        <p className="text-[12px] text-subtle">
          {s.cadence} · {s.occurrences} payments · {muted ? `last ${date(s.lastDate)}` : `next ~${date(s.nextDate)}`}
        </p>
      </div>
      <div className="text-right">
        <p className="tabular text-[14px] font-medium">{formatMoney(s.amountCents, currency)}</p>
        <p className="tabular text-[12px] text-subtle">{formatMoney(s.annualCents, currency, { decimals: false })}/yr</p>
      </div>
    </li>
  );
}
