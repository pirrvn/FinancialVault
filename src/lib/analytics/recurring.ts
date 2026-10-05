import { addDays, daysBetween } from "../dates";
import type { AnalyticsTx } from "./types";

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

const CADENCES: { cadence: Cadence; days: number; tolerance: number; minCount: number; perMonth: number }[] = [
  { cadence: "weekly", days: 7, tolerance: 2, minCount: 4, perMonth: 52 / 12 },
  { cadence: "monthly", days: 30.44, tolerance: 6, minCount: 2, perMonth: 1 },
  { cadence: "quarterly", days: 91.3, tolerance: 12, minCount: 2, perMonth: 1 / 3 },
  { cadence: "yearly", days: 365.25, tolerance: 20, minCount: 2, perMonth: 1 / 12 },
];

export interface RecurringSeries {
  merchantKey: string;
  merchantName: string;
  categoryId: string;
  categoryName: string;
  direction: "DEBIT" | "CREDIT";
  cadence: Cadence;
  occurrences: number;
  /** Typical charge (median of the last 3), positive cents. */
  amountCents: number;
  monthlyCents: number;
  annualCents: number;
  amountStable: boolean;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  active: boolean;
  /** Last charge vs the one before, when it rose by > 2%. */
  priceIncrease: { fromCents: number; toCents: number } | null;
  confidence: number;
  transactionIds: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Detect recurring charges (or income) per merchant from interval regularity and amount stability.
 * `asOf` is the latest date in the dataset — "active" is judged against it, not the wall clock,
 * so an old statement set still yields sensible results.
 */
export function detectRecurring(txs: AnalyticsTx[], opts: { direction?: "DEBIT" | "CREDIT"; asOf?: string } = {}): RecurringSeries[] {
  const direction = opts.direction ?? "DEBIT";
  const relevant = txs.filter((t) => t.kind !== "TRANSFER" && (direction === "DEBIT" ? t.amountCents < 0 : t.amountCents > 0));
  if (!relevant.length) return [];
  const asOf = new Date(
    (opts.asOf ??
      relevant
        .map((t) => t.date)
        .sort()
        .at(-1)!) + "T00:00:00Z",
  );

  const groups = new Map<string, AnalyticsTx[]>();
  for (const t of relevant) {
    const g = groups.get(t.merchantKey) ?? [];
    g.push(t);
    groups.set(t.merchantKey, g);
  }

  const out: RecurringSeries[] = [];
  for (const [key, list] of groups) {
    // Collapse multiple charges on the same day (split payments) into one event.
    const byDay = new Map<string, { amount: number; ids: string[] }>();
    for (const t of list) {
      const d = byDay.get(t.date) ?? { amount: 0, ids: [] };
      d.amount += Math.abs(t.amountCents);
      d.ids.push(t.id);
      byDay.set(t.date, d);
    }
    const events = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date: new Date(date + "T00:00:00Z"), ...v }));
    if (events.length < 2) continue;
    const intervals = events.slice(1).map((e, i) => daysBetween(events[i].date, e.date));
    const med = median(intervals);
    const spec = CADENCES.find((c) => Math.abs(med - c.days) <= c.tolerance);
    if (!spec || events.length < spec.minCount) continue;
    const regular = intervals.filter((d) => Math.abs(d - spec.days) <= spec.tolerance).length / intervals.length;
    if (regular < 0.7) continue;

    const amounts = events.map((e) => e.amount);
    const medAmount = median(amounts);
    const mad = median(amounts.map((a) => Math.abs(a - medAmount)));
    const amountStable = medAmount > 0 && mad / medAmount <= 0.1;
    // Two occurrences is thin evidence: require an identical-ish amount in that case.
    if (events.length === 2 && !amountStable) continue;
    // Highly variable "recurring" merchants (e.g. a weekly supermarket) are habits, not commitments.
    if (mad / medAmount > 0.35) continue;

    const recent = amounts.slice(-3);
    const amountCents = Math.round(median(recent));
    const last = events[events.length - 1];
    const prevAmount = events.length >= 2 ? events[events.length - 2].amount : last.amount;
    // A price increase only means something for fixed-price charges: all earlier charges flat, last one higher.
    const priorFlat = amounts.slice(0, -1).every((a) => Math.abs(a - prevAmount) <= prevAmount * 0.02);
    const priceIncrease = priorFlat && last.amount > prevAmount * 1.02 ? { fromCents: prevAmount, toCents: last.amount } : null;
    const nextDate = addDays(last.date, Math.round(spec.days));
    const sample = list[list.length - 1];
    const confidence = Math.min(1, 0.4 + 0.15 * events.length) * regular * (amountStable ? 1 : 0.8);
    out.push({
      merchantKey: key,
      merchantName: sample.merchantName,
      categoryId: sample.categoryId,
      categoryName: sample.categoryName,
      direction,
      cadence: spec.cadence,
      occurrences: events.length,
      amountCents,
      monthlyCents: Math.round(amountCents * spec.perMonth),
      annualCents: Math.round(amountCents * spec.perMonth * 12),
      amountStable,
      firstDate: events[0].date.toISOString().slice(0, 10),
      lastDate: last.date.toISOString().slice(0, 10),
      nextDate: nextDate.toISOString().slice(0, 10),
      active: daysBetween(last.date, asOf) <= spec.days * 1.5 + spec.tolerance,
      priceIncrease,
      confidence: Math.round(confidence * 100) / 100,
      transactionIds: events.flatMap((e) => e.ids),
    });
  }
  return out.sort((a, b) => b.monthlyCents - a.monthlyCents);
}
