import { describe, expect, it } from "vitest";
import { balanceCurve, categoryBreakdown, computeKpis, monthlySeries } from "@/lib/analytics/summary";
import { detectRecurring } from "@/lib/analytics/recurring";
import { merchantConcentration } from "@/lib/analytics/concentration";
import { buildBaseline, EMPTY_SCENARIO, runForecast } from "@/lib/analytics/forecast";
import { findOpportunities } from "@/lib/analytics/opportunities";
import type { AnalyticsTx } from "@/lib/analytics/types";

let n = 0;
const t = (
  date: string,
  amountCents: number,
  merchant: string,
  category: string,
  kind: AnalyticsTx["kind"] = amountCents < 0 ? "EXPENSE" : "INCOME",
): AnalyticsTx => ({
  id: `t${n++}`,
  date,
  amountCents,
  currency: "EUR",
  merchantKey: merchant.toUpperCase(),
  merchantName: merchant,
  categoryId: category,
  categoryName: category,
  kind,
  accountId: "a",
});

const months = ["2024-01", "2024-02", "2024-03", "2024-04"];
const txs: AnalyticsTx[] = months.flatMap((m, i) => [
  t(`${m}-01`, 300000, "Acme", "Salary"),
  t(`${m}-05`, -1349, "Netflix", "Subscriptions"),
  t(`${m}-06`, -1099, "Spotify", "Subscriptions"),
  t(`${m}-03`, -115000, "Foncia", "Housing"),
  t(`${m}-10`, -20000 - i * 1000, "Carrefour", "Groceries"),
  t(`${m}-15`, -50000, "Livret", "Savings & Investments", "TRANSFER"),
]);
txs.push(t("2024-04-20", -60000, "Fnac", "Shopping"));
txs.push(t("2024-04-21", 5000, "Fnac", "Shopping", "EXPENSE")); // refund inside an expense category

describe("summary", () => {
  it("excludes transfers and nets refunds into expenses", () => {
    const s = monthlySeries(txs);
    expect(s.map((p) => p.month)).toEqual(months);
    expect(s[0]).toEqual({ month: "2024-01", incomeCents: 300000, expenseCents: 1349 + 1099 + 115000 + 20000, netCents: 300000 - 137448 });
    expect(s[3].expenseCents).toBe(1349 + 1099 + 115000 + 23000 + 55000);
  });

  it("computes KPIs on a trailing window", () => {
    const k = computeKpis(txs, [{ id: "a", name: "A", institution: "X", currency: "EUR", balanceCents: 1_000_000, reported: true }], "EUR");
    expect(k.focusMonth).toBe("2024-04");
    expect(k.netWorthCents).toBe(1_000_000);
    expect(k.burnRateCents).toBe(Math.round(1349 + 1099 + 115000 + (21000 + 22000 + 23000 + 55000) / 3));
    expect(k.savingsRate).toBeGreaterThan(0.4);
    expect(k.savingsRate).toBeLessThan(0.6);
  });

  it("breakdown shares sum to one", () => {
    const b = categoryBreakdown(txs.filter((x) => x.date.startsWith("2024-04")));
    expect(b[0].categoryName).toBe("Housing");
    expect(b.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1);
  });

  it("balance curve ends at net worth", () => {
    const c = balanceCurve(txs, 1_000_000, "EUR");
    expect(c.at(-1)!.balanceCents).toBe(1_000_000);
    expect(c[0].date).toBe("2024-01-01");
  });
});

describe("recurring detection", () => {
  const subs = detectRecurring(txs);
  it("finds fixed monthly subscriptions and rent", () => {
    const names = subs.map((s) => s.merchantName);
    expect(names).toEqual(expect.arrayContaining(["Netflix", "Spotify", "Foncia"]));
    const netflix = subs.find((s) => s.merchantName === "Netflix")!;
    expect(netflix).toMatchObject({ cadence: "monthly", amountCents: 1349, annualCents: 1349 * 12, active: true, occurrences: 4 });
  });
  it("ignores transfers and one-offs", () => {
    expect(subs.map((s) => s.merchantName)).not.toContain("Livret");
    expect(subs.map((s) => s.merchantName)).not.toContain("Fnac");
  });
  it("flags price increases", () => {
    const extra = [...txs, t("2024-05-05", -1599, "Netflix", "Subscriptions")];
    const netflix = detectRecurring(extra).find((s) => s.merchantName === "Netflix")!;
    expect(netflix.priceIncrease).toEqual({ fromCents: 1349, toCents: 1599 });
  });
  it("detects recurring income", () => {
    expect(detectRecurring(txs, { direction: "CREDIT" }).map((s) => s.merchantName)).toEqual(["Acme"]);
  });
  it("marks stale series inactive relative to the dataset end", () => {
    const old = [
      t("2023-01-05", -999, "Deezer", "Subscriptions"),
      t("2023-02-05", -999, "Deezer", "Subscriptions"),
      t("2023-03-05", -999, "Deezer", "Subscriptions"),
      ...txs,
    ];
    expect(detectRecurring(old).find((s) => s.merchantName === "Deezer")?.active).toBe(false);
  });
});

describe("concentration & opportunities", () => {
  it("computes HHI", () => {
    const c = merchantConcentration(txs);
    expect(c.merchants[0].merchantName).toBe("Foncia");
    expect(c.hhi).toBeGreaterThan(0.5);
    expect(c.level).toBe("high");
  });
  it("flags overlapping streaming and spikes", () => {
    const subs = detectRecurring([...txs, ...months.map((m) => t(`${m}-08`, -1199, "Disney Plus", "Subscriptions"))]);
    const ops = findOpportunities({ txs, subscriptions: subs, concentration: merchantConcentration(txs), focusMonth: "2024-04" });
    expect(ops.find((o) => o.kind === "subscription-overlap")?.annualSavingsCents).toBe(1349 * 12);
    expect(ops.find((o) => o.kind === "category-spike")?.title).toMatch(/^Shopping/);
  });
  it("never counts rent or bills as trimmable subscriptions", () => {
    const extra = [...txs, ...months.map((m) => t(`${m}-12`, -999, "iCloud", "Subscriptions"))];
    const subs = detectRecurring([...extra, ...months.map((m) => t(`${m}-08`, -1199, "Disney Plus", "Subscriptions"))]);
    const load = findOpportunities({ txs, subscriptions: subs, concentration: merchantConcentration(txs), focusMonth: "2024-04" }).find(
      (o) => o.kind === "subscription-load",
    )!;
    expect(load.detail).not.toMatch(/Foncia/);
    expect(load.annualSavingsCents).toBe(Math.round((1349 + 1099 + 999 + 1199) * 12 * 0.15));
  });
});

describe("forecast", () => {
  const baseline = buildBaseline({
    txs,
    recurringExpenses: detectRecurring(txs),
    recurringIncome: detectRecurring(txs, { direction: "CREDIT" }),
    startBalanceCents: 1_000_000,
  });

  it("separates recurring from variable flows", () => {
    expect(baseline.recurringIncome.reduce((a, r) => a + r.monthlyCents, 0)).toBe(300000);
    expect(baseline.variableExpenses.find((v) => v.categoryName === "Subscriptions")).toBeUndefined();
    expect(baseline.startMonth).toBe("2024-04");
  });

  it("projects monotonic months with a widening band", () => {
    const f = runForecast(baseline, 12, { ...EMPTY_SCENARIO, inflation: 0 });
    expect(f).toHaveLength(12);
    expect(f[0].month).toBe("2024-05");
    expect(f[11].month).toBe("2025-04");
    expect(f[11].highCents - f[11].lowCents).toBeGreaterThan(f[0].highCents - f[0].lowCents);
    expect(f[1].balanceCents - f[0].balanceCents).toBe(f[1].netCents);
  });

  it("what-if: cancelling a subscription and a one-off purchase", () => {
    const base = runForecast(baseline, 6, { ...EMPTY_SCENARIO, inflation: 0 });
    const what = runForecast(baseline, 6, {
      ...EMPTY_SCENARIO,
      inflation: 0,
      cancelled: ["NETFLIX"],
      oneOffs: [{ id: "x", label: "Laptop", monthOffset: 2, amountCents: -150000 }],
    });
    expect(what[5].balanceCents - base[5].balanceCents).toBe(1349 * 6 - 150000);
  });
});
