import { addMonths, monthKey } from "../dates";
import { monthlySeries } from "./summary";
import type { RecurringSeries } from "./recurring";
import type { AnalyticsTx } from "./types";

export interface ForecastBaseline {
  startMonth: string;
  startBalanceCents: number;
  recurringIncome: { key: string; name: string; monthlyCents: number }[];
  recurringExpenses: { key: string; name: string; monthlyCents: number; categoryName: string }[];
  /** Median monthly non-recurring spend per category, positive cents. */
  variableExpenses: { categoryId: string; categoryName: string; monthlyCents: number }[];
  variableIncomeCents: number;
  /** Std-dev of historical monthly net cash flow, used for the confidence band. */
  volatilityCents: number;
  historyMonths: number;
}

export interface Scenario {
  /** e.g. 0.05 = +5% income */
  incomeChange: number;
  /** Applies to all variable spend. */
  expenseChange: number;
  /** Per-category adjustment on variable spend, keyed by categoryId. */
  categoryChanges: Record<string, number>;
  /** Recurring expense keys to drop (cancelled subscriptions). */
  cancelled: string[];
  /** Annual inflation applied to expenses, compounded monthly. */
  inflation: number;
  oneOffs: { id: string; label: string; monthOffset: number; amountCents: number }[];
  newRecurring: { id: string; label: string; monthlyCents: number; startOffset: number }[];
}

export const EMPTY_SCENARIO: Scenario = {
  incomeChange: 0,
  expenseChange: 0,
  categoryChanges: {},
  cancelled: [],
  inflation: 0.02,
  oneOffs: [],
  newRecurring: [],
};

export interface ForecastPoint {
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  balanceCents: number;
  lowCents: number;
  highCents: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Split history into committed (recurring) and variable flows. Variable spend is the
 * per-category median over the last `lookback` months, which is robust to one-off splurges.
 */
export function buildBaseline(input: {
  txs: AnalyticsTx[];
  recurringExpenses: RecurringSeries[];
  recurringIncome: RecurringSeries[];
  startBalanceCents: number;
  lookback?: number;
}): ForecastBaseline {
  const lookback = input.lookback ?? 6;
  const series = monthlySeries(input.txs);
  const months = series.slice(-lookback).map((p) => p.month);
  const monthSet = new Set(months);
  const lastMonth = months.at(-1) ?? monthKey(new Date());
  const activeExp = input.recurringExpenses.filter((r) => r.active);
  const activeInc = input.recurringIncome.filter((r) => r.active);
  const recurringIds = new Set([...activeExp, ...activeInc].flatMap((r) => r.transactionIds));

  const perCat = new Map<string, { name: string; byMonth: Map<string, number> }>();
  const varIncomeByMonth = new Map<string, number>();
  for (const t of input.txs) {
    const m = t.date.slice(0, 7);
    if (!monthSet.has(m) || recurringIds.has(t.id)) continue;
    if (t.kind === "EXPENSE") {
      const c = perCat.get(t.categoryId) ?? { name: t.categoryName, byMonth: new Map() };
      c.byMonth.set(m, (c.byMonth.get(m) ?? 0) - t.amountCents);
      perCat.set(t.categoryId, c);
    } else if (t.kind === "INCOME") {
      varIncomeByMonth.set(m, (varIncomeByMonth.get(m) ?? 0) + t.amountCents);
    }
  }
  const variableExpenses = [...perCat.entries()]
    .map(([categoryId, c]) => ({ categoryId, categoryName: c.name, monthlyCents: Math.max(0, Math.round(median(months.map((m) => c.byMonth.get(m) ?? 0)))) }))
    .filter((v) => v.monthlyCents > 0)
    .sort((a, b) => b.monthlyCents - a.monthlyCents);

  const nets = series.slice(-lookback).map((p) => p.netCents);
  const mean = nets.reduce((a, b) => a + b, 0) / Math.max(1, nets.length);
  const volatilityCents = Math.round(Math.sqrt(nets.reduce((a, n) => a + (n - mean) ** 2, 0) / Math.max(1, nets.length - 1)));

  return {
    startMonth: lastMonth,
    startBalanceCents: input.startBalanceCents,
    recurringIncome: activeInc.map((r) => ({ key: r.merchantKey, name: r.merchantName, monthlyCents: r.monthlyCents })),
    recurringExpenses: activeExp.map((r) => ({ key: r.merchantKey, name: r.merchantName, monthlyCents: r.monthlyCents, categoryName: r.categoryName })),
    variableExpenses,
    variableIncomeCents: Math.round(median(months.map((m) => varIncomeByMonth.get(m) ?? 0))),
    volatilityCents,
    historyMonths: months.length,
  };
}

/** Pure projection — runs in the browser for instant what-if feedback. */
export function runForecast(baseline: ForecastBaseline, horizon: number, scenario: Scenario = EMPTY_SCENARIO): ForecastPoint[] {
  const [y, m] = baseline.startMonth.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const cancelled = new Set(scenario.cancelled);
  const recurringIncome = baseline.recurringIncome.reduce((a, r) => a + r.monthlyCents, 0);
  const recurringExpense = baseline.recurringExpenses.filter((r) => !cancelled.has(r.key)).reduce((a, r) => a + r.monthlyCents, 0);
  const points: ForecastPoint[] = [];
  let balance = baseline.startBalanceCents;
  for (let i = 1; i <= horizon; i++) {
    const inflation = Math.pow(1 + scenario.inflation, i / 12);
    const variable = baseline.variableExpenses.reduce(
      (a, v) => a + v.monthlyCents * Math.max(0, 1 + scenario.expenseChange + (scenario.categoryChanges[v.categoryId] ?? 0)),
      0,
    );
    const income = (recurringIncome + baseline.variableIncomeCents) * (1 + scenario.incomeChange);
    const extraRecurring = scenario.newRecurring.filter((r) => i >= r.startOffset).reduce((a, r) => a + r.monthlyCents, 0);
    const oneOff = scenario.oneOffs.filter((o) => o.monthOffset === i).reduce((a, o) => a + o.amountCents, 0);
    const expenses = (recurringExpense + variable) * inflation + extraRecurring;
    const net = Math.round(income - expenses + oneOff);
    balance += net;
    const band = 1.28 * baseline.volatilityCents * Math.sqrt(i); // ~80% interval
    points.push({
      month: monthKey(addMonths(start, i)),
      incomeCents: Math.round(income + Math.max(0, oneOff)),
      expenseCents: Math.round(expenses - Math.min(0, oneOff)),
      netCents: net,
      balanceCents: balance,
      lowCents: Math.round(balance - band),
      highCents: Math.round(balance + band),
    });
  }
  return points;
}
