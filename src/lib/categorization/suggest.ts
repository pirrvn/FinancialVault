import { foldText } from "../text";
import { FALLBACK_EXPENSE, FALLBACK_INCOME, TRANSFER_CATEGORY, type Kind } from "./defaults";

/**
 * Local, AI-free category suggestions for merchants the rules don't know.
 * Signals, strongest first:
 *   1. a merchant you already filed that shares a distinctive word ("LIME TRAJET" ~ "LIME COURSES"),
 *   2. what the name and amount look like (a "Le …" venue for €18 is probably a bar or restaurant,
 *      €0.80 is a vending-machine coffee, "Wero vers Jean" is money to a person),
 *   3. where you usually file similar amounts,
 *   4. your most used categories.
 * Suggestions only rank choices; nothing is filed until you pick one.
 */

export interface SuggestCategory {
  id: string;
  name: string;
  kind: Kind;
  systemKey: string | null;
}

export interface KnownMerchant {
  merchantKey: string;
  merchantName: string;
  categoryId: string;
}

export interface HistoryItem {
  categoryId: string;
  amountCents: number;
  isCard: boolean;
}

export interface SuggestInput {
  merchantKey: string;
  rawDescription: string;
  /** Typical (median) signed amount of the group. */
  amountCents: number;
}

export interface Suggestion {
  categoryId: string;
  reason: string;
}

const STOPWORDS = new Set([
  "LE",
  "LA",
  "LES",
  "DE",
  "DU",
  "DES",
  "AU",
  "AUX",
  "ET",
  "EN",
  "CHEZ",
  "THE",
  "OF",
  "SAS",
  "SARL",
  "PARIS",
  "FRANCE",
  "CARTE",
  "VIR",
  "VIREMENT",
  "INST",
  "SEPA",
]);
const distinctive = (key: string) => key.split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));

export function isCardPayment(rawDescription: string): boolean {
  return /^(CARTE|CB|PAIEMENT PAR CARTE|PAIEMENT CB|ACHAT CB)\b/.test(foldText(rawDescription));
}

/** Money sent to or received from a person (Wero, Lydia, Paylib, or an instant transfer). */
export function isPersonTransfer(rawDescription: string): boolean {
  const f = foldText(rawDescription);
  return /\b(WERO|LYDIA|PAYLIB)\b/.test(f) || /^(VIREMENT|VIR)\b.*\b(VERS|DE)\s+(MR|MME|M|MLLE)?\s*[A-Z]/.test(f);
}

const VENUE_WORDS = /\b(BAR|PUB|CAFE|BALTO|COMPTOIR|BRASSERIE|BISTRO|BISTROT|TERRASSE|CAVE|TAVERNE|GUINGUETTE|ROOFTOP)\b/;
const VENUE_START = /^(LE|LA|LES|L|CHEZ|AU|AUX|O)\b/;

export function suggestCategories(
  input: SuggestInput,
  ctx: { categories: SuggestCategory[]; known: KnownMerchant[]; history: HistoryItem[] },
  limit = 6,
): Suggestion[] {
  const debit = input.amountCents < 0;
  const allowed = new Set(ctx.categories.filter((c) => c.kind === "TRANSFER" || (debit ? c.kind === "EXPENSE" : c.kind === "INCOME")).map((c) => c.id));
  const byKey = new Map(ctx.categories.filter((c) => c.systemKey).map((c) => [c.systemKey!, c.id]));
  const out: Suggestion[] = [];
  const add = (categoryId: string | undefined, reason: string) => {
    if (!categoryId || !allowed.has(categoryId) || out.some((s) => s.categoryId === categoryId)) return;
    out.push({ categoryId, reason });
  };

  // 1. Similar merchants you already filed.
  const words = distinctive(input.merchantKey);
  if (words.length) {
    const scored = ctx.known
      .filter((k) => k.merchantKey !== input.merchantKey)
      .map((k) => {
        const kw = distinctive(k.merchantKey);
        const shared = kw.filter((w) => words.includes(w)).length;
        return { k, score: shared / Math.max(words.length, kw.length || 1) };
      })
      .filter((s) => s.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, 2)) add(s.k.categoryId, `Like ${s.k.merchantName}`);
  }

  // 2. What it looks like.
  // Use the bank text, not the key: the key drops short articles ("L Ariel" -> "ARIEL").
  const folded = foldText(input.rawDescription).replace(/^(CARTE|CB|PAIEMENT PAR CARTE|PAIEMENT CB|ACHAT CB)( X?\d{4})?\s+/, "");
  const euros = Math.abs(input.amountCents) / 100;
  const card = isCardPayment(input.rawDescription);
  if (isPersonTransfer(input.rawDescription)) {
    if (debit) {
      add(byKey.get(TRANSFER_CATEGORY), "Money sent to a person");
      add(byKey.get("Bars & Nightlife"), "Paying a friend back for a night out?");
      add(byKey.get("Gifts & Donations"), "A gift or a shared present?");
    } else {
      add(byKey.get("Refunds"), "A friend paying you back");
      add(byKey.get(TRANSFER_CATEGORY), "Money from a person");
    }
  } else if (debit && card) {
    if (euros > 0 && euros < 3) add(byKey.get("Coffee & Snacks"), "Small amount, like a coffee or a vending machine");
    if (VENUE_WORDS.test(folded) || VENUE_START.test(folded)) {
      if (euros < 5) add(byKey.get("Coffee & Snacks"), "Sounds like a café");
      if (euros <= 80) add(byKey.get("Bars & Nightlife"), "Sounds like a bar or a terrace");
      add(byKey.get("Dining Out"), "Sounds like a restaurant");
    }
  }

  // 3. Where you usually file similar amounts.
  if (euros > 0) {
    const tally = new Map<string, number>();
    for (const h of ctx.history) {
      if (Math.sign(h.amountCents) !== Math.sign(input.amountCents) || h.isCard !== card) continue;
      const e = Math.abs(h.amountCents) / 100;
      if (e < euros * 0.6 || e > euros * 1.6) continue;
      tally.set(h.categoryId, (tally.get(h.categoryId) ?? 0) + 1);
    }
    const fallbackIds = new Set([byKey.get(FALLBACK_EXPENSE), byKey.get(FALLBACK_INCOME)]);
    for (const [id] of [...tally.entries()]
      .filter(([id, n]) => n >= 2 && !fallbackIds.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)) {
      add(id, "Where you usually file similar amounts");
    }
  }

  // 4. Your most used categories.
  const usage = new Map<string, number>();
  for (const h of ctx.history) usage.set(h.categoryId, (usage.get(h.categoryId) ?? 0) + 1);
  for (const [id] of [...usage.entries()].sort((a, b) => b[1] - a[1])) {
    if (out.length >= limit) break;
    add(id, "One of your most used categories");
  }
  return out.slice(0, limit);
}
