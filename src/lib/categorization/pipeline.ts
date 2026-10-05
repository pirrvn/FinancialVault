import { compileRules, matchRule, type MatchableTransaction, type RuleLike } from "./rules";
import { FALLBACK_EXPENSE, FALLBACK_INCOME, type Kind } from "./defaults";
import type { AiCategorizationInput, AiCategorizationResult, AiCategoryOption } from "../ai/categorize";

export interface PipelineCategory {
  id: string;
  name: string;
  kind: Kind;
  description?: string | null;
  /** Built-in identity (original name); fallback categories are found by it, so renaming is safe. */
  systemKey?: string | null;
}

export interface PipelineTransaction extends MatchableTransaction {
  bank: string;
}

export interface PipelineDecision {
  categoryId: string;
  source: "RULE" | "AI" | "FALLBACK";
  ruleId: string | null;
  confidence: number;
  needsReview: boolean;
}

export interface AiRuleToPersist {
  merchantKey: string;
  direction: "DEBIT" | "CREDIT";
  categoryId: string;
  confidence: number;
}

export interface PipelineOptions {
  rules: RuleLike[];
  categories: PipelineCategory[];
  /** Tier 2. Omit to run rules + fallback only (e.g. no API key). */
  ai?: (items: AiCategorizationInput[], categories: AiCategoryOption[]) => Promise<AiCategorizationResult[]>;
  describeAiError?: (err: unknown) => string;
  /** AI answers below this are still used (better than "Miscellaneous") but are flagged and never persisted as rules. */
  aiPersistThreshold?: number;
  /** AI answers below this are flagged for review. */
  aiReviewThreshold?: number;
}

export interface PipelineOutput {
  decisions: PipelineDecision[];
  aiRules: AiRuleToPersist[];
  ruleHits: Map<string, number>;
  stats: { byRule: number; byAi: number; byFallback: number; needsReview: number };
  warnings: string[];
}

function kindAllowed(kind: Kind, amountCents: number): boolean {
  if (kind === "TRANSFER") return true;
  return amountCents < 0 ? kind === "EXPENSE" : kind === "INCOME";
}

/**
 * The 3-tier categorization pipeline. Every transaction leaves with a category:
 *   1. rules (learned corrections > user rules > persisted AI decisions > built-in lexicon)
 *   2. AI inference, batched per unique merchant
 *   3. deterministic fallback by direction, flagged for review
 * Tier 3 of the product (manual override + learning) lives in services/learning.ts.
 */
export async function runPipeline(transactions: PipelineTransaction[], opts: PipelineOptions): Promise<PipelineOutput> {
  const persistThreshold = opts.aiPersistThreshold ?? 0.7;
  const reviewThreshold = opts.aiReviewThreshold ?? 0.85;
  const compiled = compileRules(opts.rules);
  const byName = new Map(opts.categories.map((c) => [c.name, c]));
  const byId = new Map(opts.categories.map((c) => [c.id, c]));
  const decisions: (PipelineDecision | null)[] = new Array(transactions.length).fill(null);
  const ruleHits = new Map<string, number>();
  const warnings: string[] = [];
  const stats = { byRule: 0, byAi: 0, byFallback: 0, needsReview: 0 };

  // Tier 1 — rules
  transactions.forEach((tx, i) => {
    const rule = matchRule(compiled, tx);
    if (!rule) return;
    const category = byId.get(rule.categoryId);
    if (!category || !kindAllowed(category.kind, tx.amountCents)) return;
    const confidence = rule.source === "AI" ? (rule.confidence ?? 0.8) : 1;
    decisions[i] = { categoryId: rule.categoryId, source: "RULE", ruleId: rule.id, confidence, needsReview: confidence < reviewThreshold };
    ruleHits.set(rule.id, (ruleHits.get(rule.id) ?? 0) + 1);
    stats.byRule++;
  });

  // Tier 2 — AI, one decision per (merchant, direction)
  const aiRules: AiRuleToPersist[] = [];
  const pending = new Map<string, { input: AiCategorizationInput; indexes: number[]; amounts: number[] }>();
  transactions.forEach((tx, i) => {
    if (decisions[i]) return;
    const direction = tx.amountCents < 0 ? "DEBIT" : "CREDIT";
    const key = `${direction}|${tx.merchantKey}`;
    let group = pending.get(key);
    if (!group) {
      group = {
        input: { merchantKey: tx.merchantKey, sampleDescriptions: [], direction, bank: tx.bank, typicalAmount: 0, occurrences: 0 },
        indexes: [],
        amounts: [],
      };
      pending.set(key, group);
    }
    group.indexes.push(i);
    group.amounts.push(Math.abs(tx.amountCents) / 100);
    if (group.input.sampleDescriptions.length < 3 && !group.input.sampleDescriptions.includes(tx.rawDescription))
      group.input.sampleDescriptions.push(tx.rawDescription);
  });

  if (pending.size && opts.ai) {
    for (const g of pending.values()) {
      const sorted = [...g.amounts].sort((a, b) => a - b);
      g.input.typicalAmount = sorted[Math.floor(sorted.length / 2)];
      g.input.occurrences = g.indexes.length;
    }
    try {
      const options: AiCategoryOption[] = opts.categories.map((c) => ({ name: c.name, kind: c.kind, description: c.description ?? "" }));
      const results = await opts.ai(
        [...pending.values()].map((g) => g.input),
        options,
      );
      for (const r of results) {
        const group = pending.get(`${r.direction}|${r.merchantKey}`);
        const category = byName.get(r.category);
        if (!group || !category) continue;
        const sampleAmount = r.direction === "DEBIT" ? -1 : 1;
        if (!kindAllowed(category.kind, sampleAmount)) continue;
        for (const i of group.indexes) {
          decisions[i] = { categoryId: category.id, source: "AI", ruleId: null, confidence: r.confidence, needsReview: r.confidence < reviewThreshold };
          stats.byAi++;
        }
        if (r.confidence >= persistThreshold)
          aiRules.push({ merchantKey: r.merchantKey, direction: r.direction, categoryId: category.id, confidence: r.confidence });
      }
    } catch (err) {
      warnings.push(opts.describeAiError?.(err) ?? "AI categorization failed; used fallback categories.");
    }
  }

  // Tier 3 — deterministic fallback: never leave a transaction uncategorized
  const fallbackExpense = fallbackCategory(opts.categories, "EXPENSE");
  const fallbackIncome = fallbackCategory(opts.categories, "INCOME");
  if (!fallbackExpense || !fallbackIncome) throw new Error("Category set must include at least one EXPENSE and one INCOME category.");
  const final = decisions.map((d, i) => {
    if (d) return d;
    stats.byFallback++;
    const category = transactions[i].amountCents < 0 ? fallbackExpense : fallbackIncome;
    return { categoryId: category.id, source: "FALLBACK" as const, ruleId: null, confidence: 0, needsReview: true };
  });
  stats.needsReview = final.filter((d) => d.needsReview).length;
  return { decisions: final, aiRules, ruleHits, stats, warnings };
}

/** The built-in catch-all for a direction ("Miscellaneous" / "Other Income"), whatever it was renamed to. */
export function fallbackCategory<T extends PipelineCategory>(categories: T[], kind: "EXPENSE" | "INCOME"): T | undefined {
  const key = kind === "EXPENSE" ? FALLBACK_EXPENSE : FALLBACK_INCOME;
  return categories.find((c) => c.systemKey === key) ?? categories.find((c) => c.name === key) ?? categories.find((c) => c.kind === kind);
}
