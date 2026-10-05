import { describe, expect, it, vi } from "vitest";
import { extractPdfItems, parseCreditAgricolePdfItems, type PdfParseResult } from "@/lib/parsers/credit-agricole-pdf";
import { parseStatement, StatementParseError } from "@/lib/parsers";
import { buildCaStatementPdf, buildModernCaStatementPdf, MODERN_OPS, SAMPLE_OPS } from "./helpers/ca-pdf";

const base = {
  arrete: "31 Janvier 2025",
  account: "Compte de Dépôt carte n° 12345678901",
  ancien: { date: "31.12.2024", amount: "1 000,00", side: "créditeur" as const },
  nouveau: { date: "31.01.2025", amount: "2 646,73", side: "créditeur" as const },
  ops: SAMPLE_OPS,
};

describe("Crédit Agricole PDF statement", async () => {
  const pdf = await buildCaStatementPdf({ ...base, opsPerPage: 5 });
  const result = parseCreditAgricolePdfItems(await extractPdfItems(pdf));

  it("reads every operation across page breaks and reconciles to the cent", () => {
    expect(result.transactions).toHaveLength(9);
    expect(result.reconciled).toBe(true);
    expect(result.reconciliationDetail[0]).toContain("1000.00 + 1646.73 = 2646.73");
  });

  it("puts amounts on the right side using the Débit/Crédit columns", () => {
    const salary = result.transactions.find((t) => t.rawDescription.includes("SALAIRE"))!;
    expect(salary.amountCents).toBe(345000);
    const rent = result.transactions.find((t) => t.rawDescription.includes("FONCIA"))!;
    expect(rent.amountCents).toBe(-118000);
    expect(result.transactions.find((t) => t.rawDescription.includes("CPAM"))!.amountCents).toBe(2310);
  });

  it("joins wrapped labels and keeps transfers to a livret as operations", () => {
    const rent = result.transactions.find((t) => t.rawDescription.includes("FONCIA"))!;
    expect(rent.rawDescription).toBe("PRLV SEPA FONCIA LOCATION ECH/030125 ID EMETTEUR/FR45ZZZ001122 MDT/LOY2023");
    expect(result.transactions.find((t) => t.rawDescription.includes("LIVRET A"))!.amountCents).toBe(-40000);
  });

  it("infers years, including December operations on a January statement", () => {
    expect(result.transactions[0].date.toISOString().slice(0, 10)).toBe("2024-12-30");
    expect(result.transactions[1].date.toISOString().slice(0, 10)).toBe("2025-01-02");
  });

  it("identifies the account and closing balance", () => {
    expect(result.transactions[0].accountRef).toBe("ACC-12345678901");
    expect(result.transactions[0].accountLabel).toBe("Crédit Agricole · Compte de Dépôt carte ••8901");
    expect(result.balances["ACC-12345678901"]).toEqual({ cents: 264673, asOf: new Date("2025-01-31T00:00:00Z") });
  });

  it("reassembles PDFs that store one glyph per text item", async () => {
    const pages = await extractPdfItems(pdf);
    const perGlyph = pages.map((items) =>
      items.flatMap((i) => [...i.str].map((ch, k) => ({ str: ch, x: i.x + (k * i.width) / i.str.length, y: i.y, width: i.width / i.str.length }))),
    );
    const r = parseCreditAgricolePdfItems(perGlyph);
    expect(r.reconciled).toBe(true);
    expect(r.transactions.map((t) => t.amountCents)).toEqual(result.transactions.map((t) => t.amountCents));
  });

  it("handles an overdrawn (débiteur) account", async () => {
    const r = parseCreditAgricolePdfItems(
      await extractPdfItems(
        await buildCaStatementPdf({
          ...base,
          ancien: { date: "31.12.2024", amount: "500,00", side: "débiteur" },
          nouveau: { date: "31.01.2025", amount: "1 146,73", side: "créditeur" },
        }),
      ),
    );
    expect(r.reconciled).toBe(true);
    expect(r.balances["ACC-12345678901"].cents).toBe(114673);
  });
});

describe("current (2026) Crédit Agricole layout", async () => {
  const pdf = await buildModernCaStatementPdf({
    arrete: "06 Mai 2026",
    holder: "Monsieur Jean Dupont",
    accountNumber: "11122233344",
    ancien: { date: "07.04.2026", amount: "1 000,00" },
    nouveau: { date: "06.05.2026", amount: "1 357,65" },
    ops: MODERN_OPS,
    opsPerPage: 7,
  });
  const r = parseCreditAgricolePdfItems(await extractPdfItems(pdf));

  it("reads every operation across pages and reconciles", () => {
    expect(r.transactions).toHaveLength(MODERN_OPS.length);
    expect(r.reconciled).toBe(true);
    expect(r.balances["ACC-11122233344"]).toEqual({ cents: 135765, asOf: new Date("2026-05-06T00:00:00Z") });
  });

  it("keeps type words and card dates in the label, without tick-box glyphs", () => {
    expect(r.transactions.map((t) => t.rawDescription)).toContain("Carte X1111 Intermarche Paris 11/04");
    expect(r.transactions.map((t) => t.rawDescription)).toContain("Prlv Prixtel");
    expect(r.transactions.every((t) => !/[¨þ]/.test(t.rawDescription))).toBe(true);
  });

  it("signs debit and credit correctly from the column positions", () => {
    const amounts = Object.fromEntries(r.transactions.map((t) => [t.rawDescription.split(" ").slice(0, 4).join(" "), t.amountCents]));
    expect(amounts["Virement Vir Inst Wero"]).toBe(2000);
    expect(amounts["Virement Wero vers Marie"]).toBe(-7500);
    expect(r.transactions.find((t) => t.rawDescription.includes("PAIE0426"))!.amountCents).toBe(102864);
  });
});

describe("PDF import safety", () => {
  it("refuses a statement whose totals don't add up when no AI is configured", async () => {
    const bad = await buildCaStatementPdf({ ...base, nouveau: { ...base.nouveau, amount: "2 700,00" } });
    await expect(parseStatement(bad, "releve.pdf")).rejects.toThrow(StatementParseError);
    await expect(parseStatement(bad, "releve.pdf")).rejects.toThrow(/don't add up/);
  });

  it("falls back to the AI reader and accepts it only if it reconciles", async () => {
    const bad = await buildCaStatementPdf({ ...base, nouveau: { ...base.nouveau, amount: "2 700,00" } });
    const good: PdfParseResult = {
      institution: "CREDIT_AGRICOLE",
      transactions: [{ date: new Date("2025-01-05T00:00:00Z"), amountCents: -100, currency: "EUR", rawDescription: "X", accountRef: "A", accountLabel: "A" }],
      balances: {},
      skipped: 0,
      warnings: [],
      reconciled: true,
      reconciliationDetail: [],
    };
    const extract = vi.fn(async () => good);
    const r = await parseStatement(bad, "releve.pdf", null, { available: true, extract, describeError: () => "x" });
    expect(extract).toHaveBeenCalledOnce();
    expect(r.transactions).toHaveLength(1);

    const mismatched = vi.fn(async () => ({ ...good, reconciled: false, reconciliationDetail: ["A: 1 + 2 ≠ 4"] }));
    await expect(parseStatement(bad, "releve.pdf", null, { available: true, extract: mismatched, describeError: () => "x" })).rejects.toThrow(
      /Nothing was imported/,
    );
  });

  it("does not call the AI when the local reading reconciles", async () => {
    const extract = vi.fn();
    const r = await parseStatement(await buildCaStatementPdf(base), "releve.pdf", null, { available: true, extract, describeError: () => "x" });
    expect(extract).not.toHaveBeenCalled();
    expect(r.transactions).toHaveLength(9);
  });
});
