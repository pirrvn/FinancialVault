"use client";

import * as React from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { Plus, RotateCcw, Trash2, Sparkles } from "lucide-react";
import { EMPTY_SCENARIO, runForecast, type ForecastBaseline, type Scenario } from "@/lib/analytics/forecast";
import { formatMoney } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import { Card, CardHeader } from "../ui/card";
import { Segmented } from "../ui/segmented";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PageHeader } from "../app-shell";
import { useChartTheme } from "../charts/chart-theme";
import { axisMoney, ChartTooltipCard, Legend } from "../charts/tooltip";
import { useCopilot } from "../copilot/copilot-provider";

const pct = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;

export function ForecastView({
  baseline,
  history,
  currency,
}: {
  baseline: ForecastBaseline;
  history: { month: string; balanceCents: number }[];
  currency: string;
}) {
  const t = useChartTheme();
  const copilot = useCopilot();
  const [horizon, setHorizon] = React.useState<3 | 6 | 12>(12);
  const [scenario, setScenario] = React.useState<Scenario>(EMPTY_SCENARIO);
  const [draft, setDraft] = React.useState({ label: "", amount: "", month: "1", recurring: false });
  const set = <K extends keyof Scenario>(k: K, v: Scenario[K]) => setScenario((s) => ({ ...s, [k]: v }));

  const base = React.useMemo(
    () => runForecast(baseline, horizon, { ...EMPTY_SCENARIO, inflation: scenario.inflation }),
    [baseline, horizon, scenario.inflation],
  );
  const what = React.useMemo(() => runForecast(baseline, horizon, scenario), [baseline, horizon, scenario]);
  const changed = JSON.stringify({ ...scenario, inflation: 0 }) !== JSON.stringify({ ...EMPTY_SCENARIO, inflation: 0 });
  const end = what.at(-1);
  const endBase = base.at(-1);
  const lowest = what.reduce((m, p) => (p.balanceCents < m.balanceCents ? p : m), what[0]);
  const firstNegative = what.find((p) => p.balanceCents < 0);
  const avgNet = what.reduce((a, p) => a + p.netCents, 0) / Math.max(1, what.length);

  const data = [
    ...history.map((h) => ({ month: h.month, history: h.balanceCents })),
    ...what.map((p, i) => ({ month: p.month, scenario: p.balanceCents, baseline: base[i].balanceCents, band: [p.lowCents, p.highCents] as [number, number] })),
  ];
  // Join the projection to the last actual point so the line is continuous.
  if (history.length && data[history.length]) {
    const last = history[history.length - 1].balanceCents;
    Object.assign(data[history.length - 1], { scenario: last, baseline: last, band: [last, last] });
  }

  const addEvent = () => {
    const amount = Math.round(parseFloat(draft.amount.replace(",", ".")) * 100);
    if (!draft.label.trim() || !Number.isFinite(amount) || amount === 0) return;
    const id = crypto.randomUUID();
    if (draft.recurring)
      set("newRecurring", [...scenario.newRecurring, { id, label: draft.label.trim(), monthlyCents: Math.abs(amount), startOffset: Number(draft.month) }]);
    else set("oneOffs", [...scenario.oneOffs, { id, label: draft.label.trim(), amountCents: amount, monthOffset: Number(draft.month) }]);
    setDraft({ label: "", amount: "", month: draft.month, recurring: draft.recurring });
  };

  return (
    <>
      <PageHeader
        title="Forecast"
        subtitle={`Projected from ${baseline.historyMonths} month(s) of history: recurring flows plus your typical variable spending.`}
        actions={
          <Segmented
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: 3, label: "3M" },
              { value: 6, label: "6M" },
              { value: 12, label: "12M" },
            ]}
          />
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Tile
          label={`Balance in ${monthLabel(end?.month ?? baseline.startMonth, "long")}`}
          value={formatMoney(end?.balanceCents ?? 0, currency, { decimals: false })}
          note={
            changed && endBase && end
              ? `${formatMoney(end.balanceCents - endBase.balanceCents, currency, { sign: true, decimals: false })} vs. current path`
              : `range ${formatMoney(end?.lowCents ?? 0, currency, { compact: true })} – ${formatMoney(end?.highCents ?? 0, currency, { compact: true })}`
          }
        />
        <Tile label="Average monthly net" value={formatMoney(avgNet, currency, { sign: true, decimals: false })} note="income minus expenses" />
        <Tile
          label={firstNegative ? "Balance turns negative" : "Lowest point"}
          value={firstNegative ? monthLabel(firstNegative.month, "long") : formatMoney(lowest?.balanceCents ?? 0, currency, { decimals: false })}
          note={firstNegative ? "on the projected path" : lowest ? monthLabel(lowest.month, "long") : ""}
          tone={firstNegative ? "negative" : undefined}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title="Projected balance" subtitle="Shaded area is the ~80% range, widening with time" />
          <div className="px-4 pt-3 pb-5 sm:px-6">
            <div className="mb-3">
              <Legend
                items={[
                  { label: "Actual", color: t.fg, kind: "line" },
                  { label: changed ? "What-if" : "Projection", color: t.accent, kind: "line" },
                  ...(changed ? [{ label: "Current path", color: t.subtle, kind: "dash" as const }] : []),
                ]}
              />
            </div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke={t.line} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(m) => monthLabel(m)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: t.subtle, fontSize: 11 }}
                    dy={6}
                    minTickGap={16}
                  />
                  <YAxis
                    tickFormatter={axisMoney(currency)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: t.subtle, fontSize: 11 }}
                    width={60}
                    domain={["auto", "auto"]}
                  />
                  <ReferenceLine y={0} stroke={t.subtle} strokeDasharray="2 3" />
                  <Tooltip
                    cursor={{ stroke: t.subtle, strokeWidth: 1 }}
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload as
                        { month: string; history?: number; scenario?: number; baseline?: number; band?: [number, number] } | undefined;
                      if (!active || !p) return null;
                      const rows = [
                        ...(p.history !== undefined ? [{ label: "Actual", valueCents: p.history, color: t.fg }] : []),
                        ...(p.history === undefined && p.scenario !== undefined
                          ? [{ label: changed ? "What-if" : "Projected", valueCents: p.scenario, color: t.accent }]
                          : []),
                        ...(p.history === undefined && changed && p.baseline !== undefined
                          ? [{ label: "Current path", valueCents: p.baseline, color: t.subtle }]
                          : []),
                      ];
                      return (
                        <ChartTooltipCard
                          title={monthLabel(p.month, "long")}
                          currency={currency}
                          rows={rows}
                          footer={
                            p.history === undefined && p.band
                              ? `Range ${formatMoney(p.band[0], currency, { decimals: false })} – ${formatMoney(p.band[1], currency, { decimals: false })}`
                              : undefined
                          }
                        />
                      );
                    }}
                  />
                  <Area dataKey="band" stroke="none" fill={t.accent} fillOpacity={0.1} isAnimationActive={false} activeDot={false} />
                  {changed && (
                    <Line dataKey="baseline" stroke={t.subtle} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />
                  )}
                  <Line
                    dataKey="history"
                    stroke={t.fg}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4.5, stroke: t.surface, strokeWidth: 2, fill: t.fg }}
                    isAnimationActive={false}
                  />
                  <Line
                    dataKey="scenario"
                    stroke={t.accent}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4.5, stroke: t.surface, strokeWidth: 2, fill: t.accent }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 border-t border-line px-6 py-5 text-[13px] sm:grid-cols-3">
            <Assumption
              label="Recurring income"
              value={baseline.recurringIncome.reduce((a, r) => a + r.monthlyCents, 0) + baseline.variableIncomeCents}
              currency={currency}
              items={baseline.recurringIncome.map((r) => r.name)}
            />
            <Assumption
              label="Recurring expenses"
              value={baseline.recurringExpenses.filter((r) => !scenario.cancelled.includes(r.key)).reduce((a, r) => a + r.monthlyCents, 0)}
              currency={currency}
              items={baseline.recurringExpenses.slice(0, 4).map((r) => r.name)}
            />
            <Assumption
              label="Typical variable spend"
              value={baseline.variableExpenses.reduce((a, v) => a + v.monthlyCents, 0)}
              currency={currency}
              items={baseline.variableExpenses.slice(0, 4).map((v) => v.categoryName)}
            />
          </div>
        </Card>

        <Card className="h-fit">
          <CardHeader
            title="What if…"
            subtitle="Changes apply instantly"
            action={
              changed ? (
                <Button variant="ghost" size="sm" onClick={() => setScenario({ ...EMPTY_SCENARIO, inflation: scenario.inflation })}>
                  <RotateCcw /> Reset
                </Button>
              ) : null
            }
          />
          <div className="space-y-5 px-6 pt-4 pb-6">
            <Slider label="Income" value={scenario.incomeChange} onChange={(v) => set("incomeChange", v)} min={-0.5} max={0.5} step={0.01} format={pct} />
            <Slider
              label="Variable spending"
              value={scenario.expenseChange}
              onChange={(v) => set("expenseChange", v)}
              min={-0.5}
              max={0.5}
              step={0.01}
              format={pct}
            />
            <Slider
              label="Inflation (yearly)"
              value={scenario.inflation}
              onChange={(v) => set("inflation", v)}
              min={0}
              max={0.08}
              step={0.005}
              format={(v) => `${(v * 100).toFixed(1)}%`}
            />

            {baseline.variableExpenses.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-[13px] font-medium text-muted hover:text-fg">Adjust by category</summary>
                <div className="mt-4 space-y-4">
                  {baseline.variableExpenses.slice(0, 8).map((v) => (
                    <Slider
                      key={v.categoryId}
                      label={
                        <>
                          {v.categoryName} <span className="text-subtle">· {formatMoney(v.monthlyCents, currency, { decimals: false })}/mo</span>
                        </>
                      }
                      value={scenario.categoryChanges[v.categoryId] ?? 0}
                      onChange={(x) => set("categoryChanges", { ...scenario.categoryChanges, [v.categoryId]: x })}
                      min={-1}
                      max={1}
                      step={0.05}
                      format={pct}
                    />
                  ))}
                </div>
              </details>
            )}

            {baseline.recurringExpenses.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-medium text-muted">Recurring charges</p>
                <ul className="divide-y divide-line rounded-2xl bg-fill">
                  {baseline.recurringExpenses.map((r) => {
                    const on = !scenario.cancelled.includes(r.key);
                    return (
                      <li key={r.key} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                        <span className={on ? "flex-1 truncate" : "flex-1 truncate text-subtle line-through"}>{r.name}</span>
                        <span className="tabular text-muted">{formatMoney(r.monthlyCents, currency, { decimals: false })}/mo</span>
                        <Switch
                          checked={on}
                          onCheckedChange={(c) => set("cancelled", c ? scenario.cancelled.filter((k) => k !== r.key) : [...scenario.cancelled, r.key])}
                          aria-label={`Keep ${r.name}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-[13px] font-medium text-muted">Events</p>
              {[
                ...scenario.oneOffs.map((o) => ({
                  id: o.id,
                  text: `${o.label} · ${formatMoney(o.amountCents, currency, { sign: true, decimals: false })} in ${o.monthOffset} mo`,
                  kind: "oneOffs" as const,
                })),
                ...scenario.newRecurring.map((r) => ({
                  id: r.id,
                  text: `${r.label} · ${formatMoney(-r.monthlyCents, currency, { decimals: false })}/mo from month ${r.startOffset}`,
                  kind: "newRecurring" as const,
                })),
              ].map((e) => (
                <div key={e.id} className="mb-1.5 flex items-center gap-2 rounded-xl bg-fill px-3 py-2 text-[12.5px]">
                  <span className="flex-1">{e.text}</span>
                  <button
                    onClick={() =>
                      e.kind === "oneOffs"
                        ? set(
                            "oneOffs",
                            scenario.oneOffs.filter((x) => x.id !== e.id),
                          )
                        : set(
                            "newRecurring",
                            scenario.newRecurring.filter((x) => x.id !== e.id),
                          )
                    }
                    className="text-subtle hover:text-negative"
                    aria-label="Remove event"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <form
                className="mt-2 grid grid-cols-[1fr_96px] gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addEvent();
                }}
              >
                <Input
                  placeholder={draft.recurring ? "e.g. Car lease" : "e.g. New laptop"}
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                />
                <Input
                  placeholder={draft.recurring ? "€/month" : "-1500"}
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
                <div className="col-span-2 flex items-center gap-2">
                  <Segmented
                    size="sm"
                    value={draft.recurring ? "r" : "o"}
                    onChange={(v) => setDraft({ ...draft, recurring: v === "r" })}
                    options={[
                      { value: "o", label: "One-off" },
                      { value: "r", label: "Monthly" },
                    ]}
                  />
                  <select
                    value={draft.month}
                    onChange={(e) => setDraft({ ...draft, month: e.target.value })}
                    className="h-8 rounded-lg bg-fill px-2 text-[16px] outline-none sm:text-xs"
                    aria-label="Month offset"
                  >
                    {Array.from({ length: horizon }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        in {m} mo
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="secondary" className="ml-auto">
                    <Plus /> Add
                  </Button>
                </div>
              </form>
              <p className="mt-1.5 text-[11.5px] text-subtle">One-offs: negative for a purchase, positive for a windfall.</p>
            </div>

            {copilot.enabled && (
              <button
                onClick={() =>
                  copilot.ask(
                    `Using my forecast over ${horizon} months, what's the most realistic way to end that period with a higher balance? Quantify the options.`,
                  )
                }
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-fill py-2.5 text-[13px] font-medium transition-colors hover:bg-fill-strong"
              >
                <Sparkles className="size-3.5 text-accent" /> Ask Copilot for a plan
              </button>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "negative" }) {
  return (
    <div className="animate-rise rounded-3xl bg-surface p-5 shadow-card">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={`mt-2 tabular text-[28px] leading-none font-semibold tracking-[-0.025em] ${tone === "negative" ? "text-negative" : ""}`}>{value}</p>
      <p className="mt-3 text-[12.5px] text-subtle">{note}</p>
    </div>
  );
}

function Assumption({ label, value, currency, items }: { label: string; value: number; currency: string; items: string[] }) {
  return (
    <div>
      <p className="text-muted">{label}</p>
      <p className="mt-0.5 tabular text-[17px] font-semibold">
        {formatMoney(value, currency, { decimals: false })}
        <span className="text-[12px] font-normal text-subtle">/mo</span>
      </p>
      {items.length > 0 && <p className="mt-1 truncate text-[12px] text-subtle">{items.join(", ")}</p>}
    </div>
  );
}
