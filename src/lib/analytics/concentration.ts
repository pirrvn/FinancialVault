import type { AnalyticsTx } from "./types";

export interface MerchantShare {
  merchantKey: string;
  merchantName: string;
  categoryName: string;
  totalCents: number;
  count: number;
  share: number;
}

export interface Concentration {
  totalCents: number;
  merchants: MerchantShare[];
  /** Herfindahl–Hirschman index over merchant shares, 0..1 (1 = all spend at one merchant). */
  hhi: number;
  top3Share: number;
  level: "low" | "moderate" | "high";
}

export function merchantConcentration(txs: AnalyticsTx[]): Concentration {
  const map = new Map<string, MerchantShare>();
  for (const t of txs) {
    if (t.kind !== "EXPENSE") continue;
    const m = map.get(t.merchantKey) ?? {
      merchantKey: t.merchantKey,
      merchantName: t.merchantName,
      categoryName: t.categoryName,
      totalCents: 0,
      count: 0,
      share: 0,
    };
    m.totalCents -= t.amountCents;
    m.count++;
    map.set(t.merchantKey, m);
  }
  const merchants = [...map.values()].filter((m) => m.totalCents > 0).sort((a, b) => b.totalCents - a.totalCents);
  const totalCents = merchants.reduce((a, m) => a + m.totalCents, 0);
  for (const m of merchants) m.share = totalCents ? m.totalCents / totalCents : 0;
  const hhi = merchants.reduce((a, m) => a + m.share * m.share, 0);
  const top3Share = merchants.slice(0, 3).reduce((a, m) => a + m.share, 0);
  return { totalCents, merchants, hhi, top3Share, level: hhi > 0.25 ? "high" : hhi > 0.15 ? "moderate" : "low" };
}
