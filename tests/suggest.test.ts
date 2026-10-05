import { describe, expect, it } from "vitest";
import { isPersonTransfer, suggestCategories, type SuggestCategory } from "@/lib/categorization/suggest";
import { DEFAULT_CATEGORIES } from "@/lib/categorization/defaults";

const categories: SuggestCategory[] = DEFAULT_CATEGORIES.map((c) => ({ id: c.name, name: c.name, kind: c.kind, systemKey: c.name }));
const ctx = (over: Partial<Parameters<typeof suggestCategories>[1]> = {}) => ({ categories, known: [], history: [], ...over });
const ids = (s: { categoryId: string }[]) => s.map((x) => x.categoryId);

describe("local suggestions (no AI)", () => {
  it("treats a 'Le …' card payment around €20 as a bar first, then a restaurant", () => {
    const s = suggestCategories({ merchantKey: "LE XVI BALTO", rawDescription: "Carte X2416 Le Xvi Balto Paris 12/04", amountCents: -1950 }, ctx());
    expect(ids(s).slice(0, 2)).toEqual(["Bars & Nightlife", "Dining Out"]);
  });

  it("keeps the article the merchant key drops (L Ariel)", () => {
    const s = suggestCategories({ merchantKey: "ARIEL", rawDescription: "Carte X2416 L Ariel Paris 10/04", amountCents: -1950 }, ctx());
    expect(ids(s)[0]).toBe("Bars & Nightlife");
  });

  it("files tiny card payments as coffee / vending", () => {
    const s = suggestCategories({ merchantKey: "PHISER", rawDescription: "Carte X2416 P H I S E R Paris 20/04", amountCents: -150 }, ctx());
    expect(ids(s)[0]).toBe("Coffee & Snacks");
  });

  it("recognizes money to and from friends", () => {
    expect(isPersonTransfer("Virement Wero vers Pierre Olivier Becker")).toBe(true);
    expect(isPersonTransfer("Virement Vir Inst Wero de Mr Louis-baptis")).toBe(true);
    expect(isPersonTransfer("Carte X2416 Velib Metropole")).toBe(false);
    const out = suggestCategories(
      { merchantKey: "PIERRE OLIVIER BECKER", rawDescription: "Virement Wero vers Pierre Olivier Becker", amountCents: -1000 },
      ctx(),
    );
    expect(ids(out)[0]).toBe("Transfers");
    const inc = suggestCategories({ merchantKey: "BAPTISTE MICHEL", rawDescription: "Virement Vir Inst Wero de Baptiste Michel", amountCents: 2000 }, ctx());
    expect(ids(inc)[0]).toBe("Refunds");
    expect(ids(inc)).not.toContain("Bars & Nightlife"); // never an expense category for money in
  });

  it("puts a merchant sharing a distinctive word with one you filed first", () => {
    const s = suggestCategories(
      { merchantKey: "FLUTE ENCHANTEE GARE", rawDescription: "Carte X2416 Flute Enchantee Gare 16/04", amountCents: -350 },
      ctx({ known: [{ merchantKey: "FLUTE ENCHANTEE", merchantName: "Flute Enchantee", categoryId: "Coffee & Snacks" }] }),
    );
    expect(s[0]).toEqual({ categoryId: "Coffee & Snacks", reason: "Like Flute Enchantee" });
  });

  it("learns where you file similar amounts", () => {
    const history = [1800, 2000, 2200].map((a) => ({ categoryId: "Canteen", amountCents: -a, isCard: true }));
    const s = suggestCategories({ merchantKey: "ZORBLAX", rawDescription: "Carte X2416 Zorblax 12/04", amountCents: -2000 }, ctx({ history }));
    expect(s[0]).toEqual({ categoryId: "Canteen", reason: "Where you usually file similar amounts" });
  });

  it("returns unique, direction-compatible suggestions", () => {
    const history = DEFAULT_CATEGORIES.map((c) => ({ categoryId: c.name, amountCents: c.kind === "INCOME" ? 100 : -100, isCard: true }));
    const s = suggestCategories({ merchantKey: "X", rawDescription: "Carte X2416 Le Bar 12/04", amountCents: -900 }, ctx({ history }), 8);
    expect(new Set(ids(s)).size).toBe(s.length);
    expect(s.every((x) => categories.find((c) => c.id === x.categoryId)!.kind !== "INCOME")).toBe(true);
  });
});
