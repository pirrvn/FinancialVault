import { foldText } from "../text";

export type MatchField = "MERCHANT" | "DESCRIPTION";
export type MatchType = "CONTAINS" | "STARTS_WITH" | "EXACT" | "REGEX";
export type Direction = "ANY" | "DEBIT" | "CREDIT";
export type RuleSourceId = "USER" | "LEARNED" | "AI" | "SYSTEM";

export interface RuleLike {
  id: string;
  categoryId: string;
  field: MatchField;
  matchType: MatchType;
  pattern: string;
  direction: Direction;
  accountId: string | null;
  priority: number;
  source: RuleSourceId;
  confidence?: number | null;
}

export interface MatchableTransaction {
  rawDescription: string;
  merchantKey: string;
  amountCents: number;
  accountId?: string | null;
}

export interface CompiledRule extends RuleLike {
  /** Receives the star-normalized text and the plain folded text (regexes may rely on literal "*"). */
  test: (value: string, raw: string) => boolean;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Canonical text that rules are matched against: folded (upper-case, no accents) and with
 * card-processor asterisks treated as spaces, so "UBER * EATS" and "UBER*EATS" read "UBER EATS".
 */
export function normalizeForMatch(input: string): string {
  return foldText(input).replace(/\*+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Turn a rule into a predicate over the folded field value.
 * CONTAINS matches at a word start, so "FEE" matches "FEES" but not "COFFEE",
 * while "PHARMA" still matches "PHARMACIE".
 */
export function compileRule(rule: RuleLike): CompiledRule | null {
  let test: CompiledRule["test"];
  if (rule.matchType === "REGEX") {
    if (rule.pattern.length > 300) return null;
    try {
      const re = new RegExp(rule.pattern, "i");
      // User regexes written against the bank text ("UBR\\*") keep working next to the "*"-free form.
      test = (v, raw) => re.test(v) || re.test(raw);
    } catch {
      return null; // invalid user regex never breaks ingestion
    }
  } else {
    const p = normalizeForMatch(rule.pattern);
    if (!p) return null;
    if (rule.matchType === "EXACT") test = (v) => v === p;
    else if (rule.matchType === "STARTS_WITH") test = (v) => v.startsWith(p);
    else {
      const re = new RegExp(`(^|[^A-Z0-9])${escapeRegex(p)}`);
      test = (v) => re.test(v);
    }
  }
  return { ...rule, test };
}

const SOURCE_RANK: Record<RuleSourceId, number> = { LEARNED: 4, USER: 3, AI: 2, SYSTEM: 1 };

/**
 * A regex's length says nothing about how specific it is. Rank it below any real keyword, so
 * "SUSHI" beats a broad bar regex on "Sushi Bar".
 */
const specificity = (r: RuleLike) => (r.matchType === "REGEX" ? 3 : r.pattern.length);

/** Sort: priority desc, then the more specific (longer) pattern, then source rank, then pattern. Deterministic. */
export function compileRules(rules: RuleLike[]): CompiledRule[] {
  return rules
    .map(compileRule)
    .filter((r): r is CompiledRule => r !== null)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        specificity(b) - specificity(a) ||
        SOURCE_RANK[b.source] - SOURCE_RANK[a.source] ||
        a.pattern.localeCompare(b.pattern) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * First rule (in priority order) that matches the transaction and that `accept` allows.
 * Callers pass a kind check so a rule whose category can't hold this money direction
 * (e.g. an expense category on a salary credit) is skipped and the next rule gets its chance.
 */
export function matchRule(rules: CompiledRule[], tx: MatchableTransaction, accept?: (rule: CompiledRule) => boolean): CompiledRule | null {
  const description = normalizeForMatch(tx.rawDescription);
  const rawDescription = foldText(tx.rawDescription);
  const merchant = normalizeForMatch(tx.merchantKey);
  for (const rule of rules) {
    if (rule.direction === "DEBIT" && tx.amountCents >= 0) continue;
    if (rule.direction === "CREDIT" && tx.amountCents <= 0) continue;
    if (rule.accountId && tx.accountId && rule.accountId !== tx.accountId) continue;
    const hit = rule.field === "MERCHANT" ? rule.test(merchant, foldText(tx.merchantKey)) : rule.test(description, rawDescription);
    if (hit && (!accept || accept(rule))) return rule;
  }
  return null;
}

/** Can a category of this kind hold a transaction with this sign? Transfers go both ways. */
export function kindFits(kind: "EXPENSE" | "INCOME" | "TRANSFER" | undefined, amountCents: number): boolean {
  if (!kind) return false;
  if (kind === "TRANSFER") return true;
  return amountCents < 0 ? kind === "EXPENSE" : kind === "INCOME";
}
