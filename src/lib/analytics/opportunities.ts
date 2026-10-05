import { foldText } from "../text";
import { formatMoney } from "../money";
import { monthlySeries } from "./summary";
import type { RecurringSeries } from "./recurring";
import type { Concentration } from "./concentration";
import type { AnalyticsTx } from "./types";

export interface Opportunity {
  id: string;
  kind: "subscription-overlap" | "price-increase" | "category-spike" | "fees" | "concentration" | "inactive-subscription" | "subscription-load";
  title: string;
  detail: string;
  /** Estimated yearly savings if acted upon, in cents (0 when not quantifiable). */
  annualSavingsCents: number;
  severity: "info" | "suggestion" | "warning";
}

const CADENCE_UNIT = { weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" } as const;

/** Categories whose recurring charges are optional services. Rent, bills, groceries or cash are not "subscriptions to trim". */
const DISCRETIONARY_CATEGORIES = new Set(["SUBSCRIPTIONS", "ENTERTAINMENT", "PERSONAL CARE"]);

const SERVICE_GROUPS: { label: string; patterns: string[] }[] = [
  {
    label: "video streaming",
    patterns: ["NETFLIX", "DISNEY", "CANAL", "PRIME VIDEO", "AMAZON PRIME", "MAX", "PARAMOUNT", "DAZN", "APPLE TV", "MOLOTOV", "BEIN", "CRUNCHYROLL", "OCS"],
  },
  { label: "music streaming", patterns: ["SPOTIFY", "DEEZER", "APPLE MUSIC", "YOUTUBE MUSIC", "TIDAL", "QOBUZ"] },
  { label: "cloud storage", patterns: ["ICLOUD", "GOOGLE ONE", "GOOGLE STORAGE", "DROPBOX", "ONEDRIVE", "PCLOUD"] },
  { label: "AI assistants", patterns: ["CHATGPT", "OPENAI", "CLAUDE", "ANTHROPIC", "PERPLEXITY", "MISTRAL", "GEMINI"] },
  { label: "gyms", patterns: ["BASIC FIT", "FITNESS PARK", "NEONESS", "CLUB MED GYM", "KEEPCOOL", "ON AIR"] },
];

export function findOpportunities(input: {
  txs: AnalyticsTx[];
  subscriptions: RecurringSeries[];
  concentration: Concentration;
  focusMonth: string;
  currency?: string;
}): Opportunity[] {
  const out: Opportunity[] = [];
  const money = (cents: number) => formatMoney(cents, input.currency ?? "EUR", { decimals: cents % 100 !== 0 && Math.abs(cents) < 100000 });
  const active = input.subscriptions.filter((s) => s.active);

  // Overlapping services in the same family
  for (const group of SERVICE_GROUPS) {
    const hits = active.filter((s) => group.patterns.some((p) => foldText(s.merchantKey).includes(p)));
    if (hits.length >= 2) {
      const cheapest = Math.min(...hits.map((h) => h.annualCents));
      const total = hits.reduce((a, h) => a + h.annualCents, 0);
      out.push({
        id: `overlap-${group.label}`,
        kind: "subscription-overlap",
        title: `${hits.length} ${group.label} services`,
        detail: `You pay for ${hits.map((h) => h.merchantName).join(", ")}. Keeping only one would save up to the amount shown.`,
        annualSavingsCents: total - cheapest,
        severity: "suggestion",
      });
    }
  }

  for (const s of active) {
    if (s.priceIncrease) {
      out.push({
        id: `price-${s.merchantKey}`,
        kind: "price-increase",
        title: `${s.merchantName} raised its price`,
        detail: `Went from ${money(s.priceIncrease.fromCents)} to ${money(s.priceIncrease.toCents)} per ${CADENCE_UNIT[s.cadence]}. Worth checking for a cheaper plan.`,
        annualSavingsCents: Math.round(((s.priceIncrease.toCents - s.priceIncrease.fromCents) * s.annualCents) / Math.max(1, s.amountCents)),
        severity: "warning",
      });
    }
  }

  const discretionary = active.filter((s) => s.amountStable && DISCRETIONARY_CATEGORIES.has(foldText(s.categoryName)));
  const monthlySubs = discretionary.reduce((a, s) => a + s.monthlyCents, 0);
  if (discretionary.length >= 3) {
    out.push({
      id: "subscription-load",
      kind: "subscription-load",
      title: `${discretionary.length} discretionary subscriptions`,
      detail: `${discretionary.map((s) => s.merchantName).join(", ")} total ${money(monthlySubs)} per month. Dropping the least-used one or two typically trims 10–20%.`,
      annualSavingsCents: Math.round(monthlySubs * 12 * 0.15),
      severity: "info",
    });
  }

  // Category spikes: focus month vs trailing 3-month average
  const byCatMonth = new Map<string, Map<string, number>>();
  const catNames = new Map<string, string>();
  for (const t of input.txs) {
    if (t.kind !== "EXPENSE") continue;
    catNames.set(t.categoryId, t.categoryName);
    const m = byCatMonth.get(t.categoryId) ?? new Map<string, number>();
    m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) ?? 0) - t.amountCents);
    byCatMonth.set(t.categoryId, m);
  }
  const months = monthlySeries(input.txs).map((p) => p.month);
  const fi = months.indexOf(input.focusMonth);
  const prior = fi > 0 ? months.slice(Math.max(0, fi - 3), fi) : [];
  if (prior.length >= 2) {
    for (const [catId, m] of byCatMonth) {
      const current = m.get(input.focusMonth) ?? 0;
      const avg = prior.reduce((a, k) => a + (m.get(k) ?? 0), 0) / prior.length;
      const spike = avg > 0 && current > avg * 1.3 && current - avg > 5000;
      const fresh = avg === 0 && current > 20000;
      if (spike || fresh) {
        out.push({
          id: `spike-${catId}`,
          kind: "category-spike",
          title: fresh ? `${catNames.get(catId)}: new spending` : `${catNames.get(catId)} up ${Math.round((current / avg - 1) * 100)}%`,
          detail: fresh
            ? `${money(Math.round(current))} this month in a category with no spend over the previous ${prior.length} months.`
            : `${money(Math.round(current))} this month vs a ${money(Math.round(avg))} average over the previous ${prior.length} months.`,
          annualSavingsCents: Math.round((current - avg) * 12),
          severity: "warning",
        });
      }
    }
  }

  // Bank fees
  const feeTotal = input.txs.filter((t) => t.kind === "EXPENSE" && foldText(t.categoryName).startsWith("FEES")).reduce((a, t) => a - t.amountCents, 0);
  const spanMonths = Math.max(1, months.length);
  if (feeTotal > 0) {
    const annual = Math.round((feeTotal / spanMonths) * 12);
    out.push({
      id: "fees",
      kind: "fees",
      title: "Bank fees",
      detail: `You paid ${money(feeTotal)} in fees over ${spanMonths} month(s). Card packages and FX fees are often negotiable or avoidable.`,
      annualSavingsCents: annual,
      severity: "suggestion",
    });
  }

  // Merchant concentration
  const top = input.concentration.merchants[0];
  if (top && top.share > 0.25 && input.concentration.totalCents > 50000) {
    out.push({
      id: `concentration-${top.merchantKey}`,
      kind: "concentration",
      title: `${Math.round(top.share * 100)}% of spending at ${top.merchantName}`,
      detail: `A single merchant dominates your expenses${top.categoryName ? ` (${top.categoryName})` : ""}. If it's discretionary, this is the highest-leverage line to review.`,
      annualSavingsCents: 0,
      severity: "info",
    });
  }

  // Recently stopped subscriptions still worth confirming as cancelled
  for (const s of input.subscriptions.filter((x) => !x.active && x.cadence === "monthly").slice(0, 3)) {
    out.push({
      id: `inactive-${s.merchantKey}`,
      kind: "inactive-subscription",
      title: `${s.merchantName} looks cancelled`,
      detail: `Last charged on ${s.lastDate}. If you didn't cancel it, check whether it moved to another card.`,
      annualSavingsCents: 0,
      severity: "info",
    });
  }

  return out.sort((a, b) => b.annualSavingsCents - a.annualSavingsCents);
}
