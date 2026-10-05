import { parseAmountToCents } from "../money";
import { parseFrenchDate } from "../dates";
import { foldText } from "../text";
import { parseRows } from "./csv";
import { StatementParseError, type ParseResult, type ParsedTransaction } from "./types";

/**
 * Crédit Agricole CSV export ("Télécharger mes opérations").
 *
 *   Téléchargement du 05/03/2024;
 *   Compte de Dépôt carte n° 12345678901;
 *   Solde au 05/03/2024 1 234,56 €
 *   Liste des opérations du compte entre le 01/02/2024 et le 29/02/2024;
 *   Date;Libellé;Débit euros;Crédit euros;
 *   05/02/2024;"PAIEMENT PAR CARTE X1234 CARREFOUR 03/02
 *   ";12,34;;
 *
 * Also accepted: "Date opération;Date valeur;Libellé;Débit;Crédit" and a single signed "Montant" column.
 * Dates are DD/MM/YYYY, amounts use comma decimals with space thousands separators, files are often Windows-1252.
 */
function findColumn(folded: string[], test: (h: string) => boolean): number | undefined {
  const i = folded.findIndex(test);
  return i >= 0 ? i : undefined;
}

export function parseCreditAgricole(text: string): ParseResult {
  const rows = parseRows(text, ";");
  const headerAt = rows.findIndex((r) => {
    const f = r.map(foldText);
    return f.some((c) => c.startsWith("DATE")) && f.some((c) => c.startsWith("LIBELLE"));
  });
  if (headerAt < 0) throw new StatementParseError("Could not find the Crédit Agricole header row (expected 'Date' and 'Libellé' columns).");

  const folded = rows[headerAt].map(foldText);
  const col = {
    date: findColumn(folded, (h) => h === "DATE" || h.startsWith("DATE OP") || h === "DATE COMPTABLE") ?? findColumn(folded, (h) => h.startsWith("DATE"))!,
    valueDate: findColumn(folded, (h) => h.startsWith("DATE VALEUR") || h.startsWith("DATE DE VALEUR")),
    label: findColumn(folded, (h) => h.startsWith("LIBELLE"))!,
    debit: findColumn(folded, (h) => h.startsWith("DEBIT")),
    credit: findColumn(folded, (h) => h.startsWith("CREDIT")),
    amount: findColumn(folded, (h) => h.startsWith("MONTANT")),
  };
  if (col.debit === undefined && col.credit === undefined && col.amount === undefined) {
    throw new StatementParseError("Crédit Agricole file has no Débit/Crédit or Montant column.");
  }

  // Preamble: account name/number and closing balance.
  const preamble = rows.slice(0, headerAt).map((r) => r.filter(Boolean).join(" "));
  const accountLine = preamble.find((l) => /compte|livret|ccp|pel|ldd/i.test(l) && !/liste des op/i.test(l));
  const accountNumber = accountLine?.match(/(\d[\d\s]{5,}\d)/)?.[1].replace(/\s/g, "");
  const accountName = accountLine
    ?.replace(/n[°o]?\s*:?\s*\d[\d\s]*/i, "")
    .replace(/[;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const accountRef = accountNumber ? `ACC-${accountNumber}` : "DEFAULT";
  const accountLabel = `Crédit Agricole · ${accountName || "Compte courant"}${accountNumber ? ` ••${accountNumber.slice(-4)}` : ""}`;

  const balances: ParseResult["balances"] = {};
  for (const line of preamble) {
    const m = foldText(line).match(/SOLDE( COMPTABLE)? AU (\d{2}\/\d{2}\/\d{4})\s*:?\s*([+-]?\s*[\d\s.,]+\d)/);
    if (m) {
      const asOf = parseFrenchDate(m[2]);
      const cents = parseAmountToCents(m[3]);
      if (asOf && cents !== null) balances[accountRef] = { cents, asOf };
    }
  }

  const transactions: ParsedTransaction[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerAt + 1)) {
    if (row.every((c) => !c)) continue;
    const date = parseFrenchDate(row[col.date] ?? "");
    const label = (row[col.label] ?? "").replace(/\s+/g, " ").trim();
    let amountCents: number | null = null;
    if (col.amount !== undefined) {
      amountCents = parseAmountToCents(row[col.amount]);
    } else {
      const debit = col.debit !== undefined ? parseAmountToCents(row[col.debit]) : null;
      const credit = col.credit !== undefined ? parseAmountToCents(row[col.credit]) : null;
      if (debit) amountCents = -Math.abs(debit);
      else if (credit) amountCents = Math.abs(credit);
    }
    if (!date || !label || !amountCents) {
      // Footer lines ("Solde au ...", totals) land here too.
      skipped++;
      continue;
    }
    transactions.push({
      date,
      valueDate: col.valueDate !== undefined ? parseFrenchDate(row[col.valueDate] ?? "") : null,
      amountCents,
      currency: "EUR",
      rawDescription: label,
      bankType: null,
      accountRef,
      accountLabel,
    });
  }
  const warnings: string[] = [];
  if (!transactions.length) warnings.push("No transactions found in this file.");
  return { institution: "CREDIT_AGRICOLE", transactions, balances, skipped, warnings };
}
