import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectInstitution, parseStatement } from "@/lib/parsers";
import { decodeStatement } from "@/lib/parsers/csv";
import { parseAmountToCents } from "@/lib/money";
import { parseFrenchDate } from "@/lib/dates";
import { merchantKey } from "@/lib/categorization/merchant";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("amount parsing", () => {
  it.each([
    ["1 234,56", 123456],
    ["1 234,56 €", 123456],
    ["-12,50", -1250],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["-14.20", -1420],
    ["+3,00", 300],
    ["(5.00)", -500],
    ["12-", -1200],
    ["", null],
    ["abc", null],
  ])("%s -> %s", (raw, expected) => expect(parseAmountToCents(raw)).toBe(expected));
});

describe("dates", () => {
  it("parses DD/MM/YYYY as UTC calendar days", () => {
    expect(parseFrenchDate("05/02/2024")?.toISOString()).toBe("2024-02-05T00:00:00.000Z");
    expect(parseFrenchDate("31/02/2024")).toBeNull();
    expect(parseFrenchDate("05/02/24")?.toISOString().slice(0, 10)).toBe("2024-02-05");
  });
});

describe("Revolut parser", async () => {
  const bytes = fixture("revolut.csv");
  it("detects the format", () => expect(detectInstitution(decodeStatement(bytes))).toBe("REVOLUT"));
  const result = await parseStatement(bytes, "account-statement.csv");

  it("skips pending and reverted rows", () => {
    expect(result.transactions.map((t) => t.rawDescription)).not.toContain("Pending Thing");
    expect(result.transactions.map((t) => t.rawDescription)).not.toContain("Declined Shop");
    expect(result.skipped).toBe(2);
    expect(result.warnings.join(" ")).toMatch(/pending/);
  });

  it("uses completed date and nets fees into the amount", () => {
    const atm = result.transactions.find((t) => t.rawDescription.startsWith("Cash"))!;
    expect(atm.amountCents).toBe(-10200);
    const uber = result.transactions.find((t) => t.rawDescription === "Uber")!;
    expect(uber.date.toISOString().slice(0, 10)).toBe("2024-01-04");
  });

  it("routes currencies to separate accounts and keeps the latest balance", () => {
    expect(new Set(result.transactions.map((t) => t.accountRef))).toEqual(new Set(["Current:EUR", "Current:USD"]));
    expect(result.balances["Current:EUR"]).toEqual({ cents: 48522, asOf: new Date("2024-02-06T00:00:00Z") });
    expect(result.balances["Current:USD"].cents).toBe(9200);
  });

  it("keeps identical same-day rows", () => {
    expect(result.transactions.filter((t) => t.rawDescription === "Le Petit Zinc")).toHaveLength(2);
  });
});

describe("Crédit Agricole parser", async () => {
  const bytes = fixture("credit-agricole.csv");
  it("decodes Windows-1252", () => expect(decodeStatement(bytes)).toContain("Libellé"));
  it("detects the format", () => expect(detectInstitution(decodeStatement(bytes))).toBe("CREDIT_AGRICOLE"));
  const result = await parseStatement(bytes, "CA20240305.csv");

  it("parses debit/credit columns with French amounts", () => {
    expect(result.transactions).toHaveLength(8);
    const salary = result.transactions[0];
    expect(salary.amountCents).toBe(320000);
    expect(salary.date.toISOString().slice(0, 10)).toBe("2024-02-01");
    const rent = result.transactions.find((t) => t.rawDescription.includes("FONCIA"))!;
    expect(rent.amountCents).toBe(-115000);
  });

  it("collapses multi-line labels", () => {
    expect(result.transactions[1].rawDescription).toBe("PRLV SEPA FREE MOBILE ECH/030224 ID EMETTEUR/FR12ZZZ123456 MDT/0001");
  });

  it("reads account identity and closing balance from the preamble", () => {
    const t = result.transactions[0];
    expect(t.accountRef).toBe("ACC-12345678901");
    expect(t.accountLabel).toBe("Crédit Agricole · Compte de Dépôt carte ••8901");
    expect(result.balances["ACC-12345678901"]).toEqual({ cents: 234567, asOf: new Date("2024-03-05T00:00:00Z") });
  });
});

describe("merchant normalization", () => {
  it.each([
    ["PAIEMENT PAR CARTE X1234 CARREFOUR CITY 04/02", "CARREFOUR CITY"],
    ["CB CARREFOUR CITY 12/03", "CARREFOUR CITY"],
    ["PRLV SEPA FREE MOBILE ECH/030224 ID EMETTEUR/FR12ZZZ123456 MDT/0001", "FREE MOBILE"],
    ["VIR SEPA RECU /DE ACME SAS /MOTIF SALAIRE FEVRIER", "ACME"],
    ["RETRAIT DAB 11/02 CARTE X1234", "RETRAIT DAB"],
    ["Netflix", "NETFLIX"],
    ["Café de Flore", "CAFE DE FLORE"],
    ["AMAZON PAYMENTS EUROPE 4DE2F*K91", "AMAZON PAYMENTS EUROPE"],
  ])("%s -> %s", (raw, key) => expect(merchantKey(raw)).toBe(key));
});
