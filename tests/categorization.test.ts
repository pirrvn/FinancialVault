import { describe, expect, it, vi } from "vitest";
import { compileRules, matchRule, type RuleLike } from "@/lib/categorization/rules";
import { runPipeline, type PipelineCategory } from "@/lib/categorization/pipeline";
import { DEFAULT_CATEGORIES, PRIORITY, SYSTEM_RULES } from "@/lib/categorization/defaults";
import { merchantKey } from "@/lib/categorization/merchant";

const categories: PipelineCategory[] = DEFAULT_CATEGORIES.map((c) => ({
  id: `cat-${c.name}`,
  name: c.name,
  kind: c.kind,
  description: c.description,
  systemKey: c.name,
}));
const cat = (name: string) => `cat-${name}`;

const systemRules: RuleLike[] = SYSTEM_RULES.map((r, i) => ({
  id: `sys-${i}`,
  categoryId: cat(r.category),
  field: "DESCRIPTION",
  matchType: r.matchType ?? "CONTAINS",
  pattern: r.pattern,
  direction: r.direction ?? "ANY",
  accountId: null,
  priority: PRIORITY.SYSTEM,
  source: "SYSTEM",
}));

const tx = (rawDescription: string, amountCents: number) => ({
  rawDescription,
  merchantKey: merchantKey(rawDescription),
  amountCents,
  accountId: "acc",
  bank: "Revolut",
});

describe("rule matching", () => {
  const compiled = compileRules(systemRules);
  const categoryOf = (desc: string, amount = -1000) => {
    const r = matchRule(compiled, tx(desc, amount));
    return r ? r.categoryId.replace("cat-", "") : null;
  };

  it("matches at word starts, not inside words", () => {
    expect(categoryOf("COFFEE SHOP MARAIS")).toBe("Coffee & Snacks"); // and never Fees: "FEE" must not match "COFFEE"
    expect(categoryOf("ATELIER TIERCE")).toBeNull();
    expect(categoryOf("PHARMACIE DU CENTRE")).toBe("Health");
  });

  it("prefers the more specific pattern among equal priorities", () => {
    expect(categoryOf("UBER EATS PARIS")).toBe("Dining Out");
    expect(categoryOf("UBER *TRIP")).toBe("Transport");
    expect(categoryOf("PRLV SEPA ASSURANCE VIE GENERALI")).toBe("Savings & Investments");
    expect(categoryOf("GRAND FRAIS")).toBe("Groceries");
  });

  it("respects amount direction", () => {
    expect(categoryOf("VIR SALAIRE ACME", 300000)).toBe("Salary");
    expect(categoryOf("SALAIRE ACME", -300000)).toBeNull();
  });

  it("learned rules beat everything", () => {
    const learned: RuleLike = {
      id: "l1",
      categoryId: cat("Groceries"),
      field: "MERCHANT",
      matchType: "EXACT",
      pattern: "UBER",
      direction: "DEBIT",
      accountId: null,
      priority: PRIORITY.LEARNED,
      source: "LEARNED",
    };
    const r = matchRule(compileRules([...systemRules, learned]), tx("Uber", -1500));
    expect(r?.id).toBe("l1");
  });

  it("ignores invalid regexes instead of throwing", () => {
    const bad: RuleLike = {
      id: "bad",
      categoryId: cat("Travel"),
      field: "DESCRIPTION",
      matchType: "REGEX",
      pattern: "([",
      direction: "ANY",
      accountId: null,
      priority: 500,
      source: "USER",
    };
    expect(compileRules([bad])).toHaveLength(0);
  });
});

describe("real Crédit Agricole statement formats", () => {
  const compiled = compileRules(systemRules);
  const categoryOf = (desc: string, amount = -1000) => {
    const r = matchRule(compiled, tx(desc, amount));
    return r ? r.categoryId.replace("cat-", "") : null;
  };

  it.each([
    ["Carte X2416 Uber * Eats Pending 12/04", "Dining Out"],
    ["Carte X2416 Ubr* Pending.uber.co 12/04", "Transport"],
    ["Carte X2416 MONOP4801 Paris 24/04", "Groceries"],
    ["Carte X2416 Maxicoffee Idf Gones 28/04", "Coffee & Snacks"],
    ["Carte X2416 Nyx*cascade Lacourne 28/04", "Coffee & Snacks"],
    ["Carte X2416 Sq *noir Coffee Shop 25/04", "Coffee & Snacks"],
    ["Carte X2416 Le Bar Du Coin Paris 12/04", "Bars & Nightlife"],
    ["Carte X2416 Brewdog Paris 12/04", "Bars & Nightlife"],
    ["Carte X2416 La Terrasse Mira Par 18/04", "Bars & Nightlife"],
    ["Carte X2416 Crous Paris 12/04", "Canteen"],
    ["Carte X2416 Lw*sncf Connect Pari 04/05", "Travel"],
    ["Carte X2416 Velib Metropole Vill 26/04", "Transport"],
    ["Carte X2416 Apple Cork 03/05", "Subscriptions"],
    ["Prlv Prixtel", "Utilities"],
    ["Cotis ** Offre Essentiel", "Fees & Charges"],
    ["Prlv Sepa Allianz Iard", "Insurance"],
  ])("%s → %s", (desc, expected) => expect(categoryOf(desc)).toBe(expected));

  it("never files a card payment at an insurer-employer (canteen top-up) as insurance", () => {
    expect(categoryOf("Carte X2416 Allianz Paris La Def 13/04")).toBeNull();
  });

  it("recognizes payroll references and own-account transfers", () => {
    expect(categoryOf("Virement Allianz Global Corporate & Speci A6126108-00115000022026000000000274PAIE0426", 102864)).toBe("Salary");
    expect(categoryOf("Virement Vir Inst vers Pierre Revolut", -50000)).toBe("Transfers");
    expect(categoryOf("Carte X2416 Paiement Paris 12/04", 500)).toBeNull(); // "PAIEMENT" is not "PAIE"
  });

  it("does not let a person named Paul become a bakery", () => {
    expect(categoryOf("Virement Wero vers Paul Martin", -2000)).toBeNull();
  });
});

describe("pipeline", () => {
  it("finds the fallback category by systemKey even after the user renamed it", async () => {
    const renamed = categories.map((c) => (c.systemKey === "Miscellaneous" ? { ...c, name: "Divers" } : c));
    const out = await runPipeline([tx("ZORBLAX ATELIER", -8990)], { rules: [], categories: renamed });
    expect(out.decisions[0].categoryId).toBe(cat("Miscellaneous"));
  });

  it("never leaves a transaction uncategorized without AI", async () => {
    const txs = [tx("Netflix", -1349), tx("ZORBLAX ATELIER", -8990), tx("VIR DE MAMIE", 5000)];
    const out = await runPipeline(txs, { rules: systemRules, categories });
    expect(out.decisions.every((d) => d.categoryId)).toBe(true);
    expect(out.decisions[0]).toMatchObject({ source: "RULE", categoryId: cat("Subscriptions"), needsReview: false });
    expect(out.decisions[1]).toMatchObject({ source: "FALLBACK", categoryId: cat("Miscellaneous"), needsReview: true });
    expect(out.decisions[2]).toMatchObject({ source: "FALLBACK", categoryId: cat("Other Income") });
  });

  it("asks the AI once per merchant and persists only confident answers", async () => {
    const ai = vi.fn(async (items: { merchantKey: string; direction: "DEBIT" | "CREDIT" }[]) =>
      items.map((i) => ({
        merchantKey: i.merchantKey,
        direction: i.direction,
        category: i.merchantKey.startsWith("ZORBLAX") ? "Shopping" : "Dining Out",
        confidence: i.merchantKey.startsWith("ZORBLAX") ? 0.95 : 0.5,
      })),
    );
    const txs = [tx("ZORBLAX ATELIER", -8990), tx("ZORBLAX ATELIER", -1990), tx("CHEZ MOMO", -2300)];
    const out = await runPipeline(txs, { rules: [], categories, ai });
    expect(ai).toHaveBeenCalledTimes(1);
    expect(ai.mock.calls[0][0]).toHaveLength(2);
    expect(out.decisions.map((d) => d.source)).toEqual(["AI", "AI", "AI"]);
    expect(out.decisions[2].needsReview).toBe(true);
    expect(out.aiRules).toEqual([{ merchantKey: "ZORBLAX ATELIER", direction: "DEBIT", categoryId: cat("Shopping"), confidence: 0.95 }]);
  });

  it("rejects AI answers whose kind contradicts the money direction", async () => {
    const ai = async () => [{ merchantKey: "CHEZ MOMO", direction: "DEBIT" as const, category: "Salary", confidence: 0.99 }];
    const out = await runPipeline([tx("CHEZ MOMO", -2300)], { rules: [], categories, ai });
    expect(out.decisions[0].source).toBe("FALLBACK");
  });

  it("degrades to fallback with a warning when the AI call fails", async () => {
    const ai = async () => {
      throw new Error("boom");
    };
    const out = await runPipeline([tx("CHEZ MOMO", -2300)], { rules: [], categories, ai, describeAiError: () => "AI down" });
    expect(out.decisions[0].source).toBe("FALLBACK");
    expect(out.warnings).toEqual(["AI down"]);
  });
});
