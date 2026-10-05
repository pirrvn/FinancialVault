import { merchantDisplayName, merchantKey } from "./merchant";

/**
 * Plan for bringing stored merchant keys up to date after the key normalizer changes.
 * Transactions get their key and display name recomputed from the bank text. Learned and user
 * merchant rules (MERCHANT/EXACT) follow their merchant: a rule on an old key moves to every new key
 * that old key's transactions now have, so past corrections keep applying. When two rules land on the
 * same key, the stronger one wins (learned > user > AI > built-in, then priority, then most recent).
 * A rule with no transaction left to tell where its merchant went is kept as is.
 */

export type RekeyDirection = "ANY" | "DEBIT" | "CREDIT";
export type RekeySource = "LEARNED" | "USER" | "AI" | "SYSTEM";

export interface RekeyTransaction {
  id: string;
  rawDescription: string;
  merchantKey: string;
  merchantName: string;
  amountCents: number;
}

export interface RekeyRule {
  id: string;
  pattern: string;
  direction: RekeyDirection;
  source: RekeySource;
  priority: number;
  updatedAt: Date;
}

export interface RekeyPlan {
  transactions: { id: string; merchantKey: string; merchantName: string }[];
  /** Existing rules whose pattern changes. */
  updateRules: { id: string; pattern: string }[];
  /** New rules copied from an existing one (its merchant split into several keys). */
  copyRules: { fromId: string; pattern: string }[];
  /** Rules beaten by a stronger rule on the same key. */
  deleteRules: string[];
}

const SOURCE_RANK: Record<RekeySource, number> = { LEARNED: 4, USER: 3, AI: 2, SYSTEM: 1 };

function stronger(a: RekeyRule, b: RekeyRule): number {
  return SOURCE_RANK[b.source] - SOURCE_RANK[a.source] || b.priority - a.priority || b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id);
}

export function planRekey(transactions: RekeyTransaction[], rules: RekeyRule[]): RekeyPlan {
  const plan: RekeyPlan = { transactions: [], updateRules: [], copyRules: [], deleteRules: [] };

  // old key (per direction) -> new keys, with counts so the most common new key comes first
  const moves = new Map<string, Map<string, number>>();
  for (const tx of transactions) {
    const key = merchantKey(tx.rawDescription);
    const name = merchantDisplayName(key, tx.rawDescription);
    if (key !== tx.merchantKey || name !== tx.merchantName) plan.transactions.push({ id: tx.id, merchantKey: key, merchantName: name });
    const slot = `${tx.amountCents < 0 ? "DEBIT" : "CREDIT"}|${tx.merchantKey}`;
    const counts = moves.get(slot) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    moves.set(slot, counts);
  }

  const targetsOf = (rule: RekeyRule): string[] => {
    const counts = new Map<string, number>();
    const dirs = rule.direction === "ANY" ? ["DEBIT", "CREDIT"] : [rule.direction];
    for (const d of dirs) for (const [k, n] of moves.get(`${d}|${rule.pattern}`) ?? []) counts.set(k, (counts.get(k) ?? 0) + n);
    if (!counts.size) return [rule.pattern];
    return [...counts.entries()]
      .sort((a, b) => Number(b[0] === rule.pattern) - Number(a[0] === rule.pattern) || b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
  };

  // Every (direction, key) slot goes to the strongest rule that wants it.
  const owner = new Map<string, RekeyRule>();
  const wanted = new Map<string, string[]>();
  for (const rule of rules) {
    const targets = targetsOf(rule);
    wanted.set(rule.id, targets);
    for (const t of targets) {
      const slot = `${rule.direction}|${t}`;
      const current = owner.get(slot);
      if (!current || stronger(rule, current) < 0) owner.set(slot, rule);
    }
  }

  for (const rule of rules) {
    const won = wanted.get(rule.id)!.filter((t) => owner.get(`${rule.direction}|${t}`) === rule);
    if (!won.length) {
      plan.deleteRules.push(rule.id);
      continue;
    }
    // Keep the rule itself on its first key (its own when still in use), copy it to the others.
    if (won[0] !== rule.pattern) plan.updateRules.push({ id: rule.id, pattern: won[0] });
    for (const t of won.slice(1)) plan.copyRules.push({ fromId: rule.id, pattern: t });
  }
  return plan;
}
