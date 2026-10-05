import { addMonths, monthKey, monthRange } from "../dates";
import type { AccountBalance, AnalyticsTx } from "./types";

export interface MonthPoint {
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

const isIncome = (t: AnalyticsTx) => t.kind === "INCOME";
const isExpense = (t: AnalyticsTx) => t.kind === "EXPENSE";

/**
 * Income/expense per month. Transfers are excluded. A refund booked in an EXPENSE category
 * (positive amount) reduces that month's expenses instead of counting as income.
 */
export function monthlySeries(txs: AnalyticsTx[], from?: string, to?: string): MonthPoint[] {
  if (!txs.length && (!from || !to)) return [];
  const months = new Map<string, MonthPoint>();
  const keys = txs.map((t) => t.date.slice(0, 7)).sort();
  const range = monthRange(from ?? keys[0], to ?? keys[keys.length - 1]);
  for (const m of range) months.set(m, { month: m, incomeCents: 0, expenseCents: 0, netCents: 0 });
  for (const t of txs) {
    const p = months.get(t.date.slice(0, 7));
    if (!p) continue;
    if (isIncome(t)) p.incomeCents += t.amountCents;
    else if (isExpense(t)) p.expenseCents -= t.amountCents;
  }
  for (const p of months.values()) p.netCents = p.incomeCents - p.expenseCents;
  return [...months.values()];
}

export interface CategorySlice {
  categoryId: string;
  categoryName: string;
  totalCents: number;
  share: number;
  count: number;
}

export function categoryBreakdown(txs: AnalyticsTx[], kind: "EXPENSE" | "INCOME" = "EXPENSE"): CategorySlice[] {
  const map = new Map<string, CategorySlice>();
  for (const t of txs) {
    if (t.kind !== kind) continue;
    const s = map.get(t.categoryId) ?? { categoryId: t.categoryId, categoryName: t.categoryName, totalCents: 0, share: 0, count: 0 };
    s.totalCents += kind === "EXPENSE" ? -t.amountCents : t.amountCents;
    s.count++;
    map.set(t.categoryId, s);
  }
  const slices = [...map.values()].filter((s) => s.totalCents > 0);
  const total = slices.reduce((a, s) => a + s.totalCents, 0);
  for (const s of slices) s.share = total ? s.totalCents / total : 0;
  return slices.sort((a, b) => b.totalCents - a.totalCents);
}

export interface Kpis {
  focusMonth: string;
  netWorthCents: number;
  netWorthChangeCents: number;
  cashFlowCents: number;
  cashFlowPrevCents: number;
  savingsRate: number;
  savingsRatePrev: number;
  burnRateCents: number;
  burnRatePrevCents: number;
  runwayMonths: number;
}

function window(series: MonthPoint[], endIdx: number, size: number) {
  return series.slice(Math.max(0, endIdx - size + 1), endIdx + 1);
}

/**
 * KPIs anchored on a focus month (default: latest month with data).
 * Savings rate and burn rate use a trailing 3-month window to smooth out lumpy months.
 */
export function computeKpis(txs: AnalyticsTx[], accounts: AccountBalance[], baseCurrency: string, focusMonth?: string): Kpis {
  const base = txs.filter((t) => t.currency === baseCurrency);
  const series = monthlySeries(base);
  const focus = focusMonth ?? series.at(-1)?.month ?? monthKey(new Date());
  const idx = series.findIndex((p) => p.month === focus);
  const cur = idx >= 0 ? series[idx] : undefined;
  const prev = idx > 0 ? series[idx - 1] : undefined;
  const w = idx >= 0 ? window(series, idx, 3) : [];
  const wPrev = idx >= 1 ? window(series, idx - 1, 3) : [];
  const rate = (ps: MonthPoint[]) => {
    const inc = ps.reduce((a, p) => a + p.incomeCents, 0);
    const net = ps.reduce((a, p) => a + p.netCents, 0);
    return inc > 0 ? net / inc : 0;
  };
  const burn = (ps: MonthPoint[]) => (ps.length ? Math.round(ps.reduce((a, p) => a + p.expenseCents, 0) / ps.length) : 0);

  const netWorthCents = accounts.filter((a) => a.currency === baseCurrency).reduce((a, acc) => a + acc.balanceCents, 0);
  // Net worth change over the focus month = all base-currency flows booked in it (transfers to
  // non-imported accounts included, since they leave the tracked balance).
  const netWorthChangeCents = base.filter((t) => t.date.startsWith(focus)).reduce((a, t) => a + t.amountCents, 0);
  const burnRateCents = burn(w);
  return {
    focusMonth: focus,
    netWorthCents,
    netWorthChangeCents,
    cashFlowCents: cur?.netCents ?? 0,
    cashFlowPrevCents: prev?.netCents ?? 0,
    savingsRate: rate(w),
    savingsRatePrev: rate(wPrev),
    burnRateCents,
    burnRatePrevCents: burn(wPrev),
    runwayMonths: burnRateCents > 0 ? netWorthCents / burnRateCents : Infinity,
  };
}

/** Daily balance curve ending at today's net worth: balance(d) = netWorth - Σ flows after d. */
export function balanceCurve(txs: AnalyticsTx[], netWorthCents: number, baseCurrency: string, months = 12): { date: string; balanceCents: number }[] {
  const base = txs.filter((t) => t.currency === baseCurrency).sort((a, b) => a.date.localeCompare(b.date));
  if (!base.length) return [];
  const byDay = new Map<string, number>();
  for (const t of base) byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amountCents);
  const days = [...byDay.keys()].sort();
  const last = new Date(days[days.length - 1] + "T00:00:00Z");
  const start = addMonths(last, -months).toISOString().slice(0, 10);
  const points: { date: string; balanceCents: number }[] = [];
  let balance = netWorthCents;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i] < start) break;
    points.push({ date: days[i], balanceCents: balance });
    balance -= byDay.get(days[i])!;
  }
  return points.reverse();
}
