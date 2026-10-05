import { parseAmountToCents } from "../money";
import { parseFrenchDate, parseIsoDate } from "../dates";
import { foldText } from "../text";
import { parseRows } from "./csv";
import { StatementParseError, type ParseResult, type ParsedTransaction } from "./types";

/**
 * Revolut account statement CSV.
 *
 * Current format (EN/FR exports):
 *   Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
 *   Type,Produit,Date de début,Date de fin,Description,Montant,Frais,Devise,État,Solde
 * Legacy format (semicolon):
 *   Completed Date;Description;Paid Out (EUR);Paid In (EUR);Exchange Out;Exchange In;Balance (EUR);Category;Notes
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  type: ["TYPE"],
  product: ["PRODUCT", "PRODUIT"],
  started: ["STARTED DATE", "DATE DE DEBUT"],
  completed: ["COMPLETED DATE", "DATE DE FIN", "DATE D'ACHEVEMENT"],
  description: ["DESCRIPTION", "REFERENCE"],
  amount: ["AMOUNT", "MONTANT"],
  fee: ["FEE", "FRAIS"],
  currency: ["CURRENCY", "DEVISE"],
  state: ["STATE", "ETAT", "STATUT"],
  balance: ["BALANCE", "SOLDE"],
  paidOut: ["PAID OUT"],
  paidIn: ["PAID IN"],
};

const IGNORED_STATES = new Set(["REVERTED", "DECLINED", "FAILED", "ANNULE", "REFUSE", "ECHOUE"]);
const PENDING_STATES = new Set(["PENDING", "EN ATTENTE"]);

function indexColumns(header: string[]): Record<string, number> {
  const folded = header.map((h) => foldText(h));
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const i = folded.findIndex((h) => aliases.some((a) => h === a || h.startsWith(a + " (")));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

function parseRevolutDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  return parseIsoDate(raw) ?? parseFrenchDate(raw.split(" ")[0]) ?? null;
}

export function parseRevolut(text: string): ParseResult {
  const rows = parseRows(text);
  const headerAt = rows.findIndex((r) => {
    const f = r.map(foldText);
    return f.includes("DESCRIPTION") && f.some((c) => c.includes("DATE"));
  });
  if (headerAt < 0) throw new StatementParseError("Could not find the Revolut header row (expected columns like 'Completed Date' and 'Description').");
  const header = rows[headerAt];
  const col = indexColumns(header);
  const legacy = col.amount === undefined && (col.paidOut !== undefined || col.paidIn !== undefined);
  if (col.description === undefined || (col.completed === undefined && col.started === undefined) || (col.amount === undefined && !legacy)) {
    throw new StatementParseError("Unrecognized Revolut CSV layout: missing date, description or amount columns.");
  }
  // Legacy exports carry the currency in the header: "Paid Out (EUR)".
  const legacyCurrency = header.map((h) => h.match(/\(([A-Z]{3})\)/)?.[1]).find(Boolean) ?? "EUR";

  const transactions: ParsedTransaction[] = [];
  const balances: ParseResult["balances"] = {};
  const warnings: string[] = [];
  let skipped = 0;
  let pending = 0;

  for (const row of rows.slice(headerAt + 1)) {
    if (row.every((c) => !c)) continue;
    const state = col.state !== undefined ? foldText(row[col.state] ?? "") : "COMPLETED";
    if (IGNORED_STATES.has(state)) {
      skipped++;
      continue;
    }
    if (PENDING_STATES.has(state)) {
      // Pending rows change date/amount when they settle; importing them would create duplicates later.
      pending++;
      skipped++;
      continue;
    }
    const date = parseRevolutDate(row[col.completed ?? -1]) ?? parseRevolutDate(row[col.started ?? -1]);
    const description = (row[col.description] ?? "").replace(/\s+/g, " ").trim();
    let amountCents: number | null;
    if (legacy) {
      const out = parseAmountToCents(row[col.paidOut ?? -1]) ?? 0;
      const inn = parseAmountToCents(row[col.paidIn ?? -1]) ?? 0;
      amountCents = inn - Math.abs(out);
    } else {
      amountCents = parseAmountToCents(row[col.amount!]);
      const fee = col.fee !== undefined ? (parseAmountToCents(row[col.fee]) ?? 0) : 0;
      if (amountCents !== null) amountCents -= Math.abs(fee);
    }
    if (!date || amountCents === null || !description) {
      skipped++;
      continue;
    }
    if (amountCents === 0) {
      skipped++;
      continue;
    }
    const currency = (col.currency !== undefined ? row[col.currency] : legacyCurrency)?.toUpperCase() || "EUR";
    const product = (col.product !== undefined ? row[col.product] : "") || "Current";
    const accountRef = `${product}:${currency}`;
    const balanceAfterCents = col.balance !== undefined ? parseAmountToCents(row[col.balance]) : null;
    transactions.push({
      date,
      amountCents,
      currency,
      rawDescription: description,
      bankType: col.type !== undefined ? row[col.type] || null : null,
      balanceAfterCents,
      accountRef,
      accountLabel: `Revolut ${product} · ${currency}`,
    });
    if (balanceAfterCents !== null && balanceAfterCents !== undefined) {
      const prev = balances[accountRef];
      // Rows are chronological; on equal dates the later row in the file is the newer balance.
      if (!prev || date.getTime() >= prev.asOf.getTime()) balances[accountRef] = { cents: balanceAfterCents, asOf: date };
    }
  }
  if (pending) warnings.push(`${pending} pending transaction(s) were skipped; they'll import once completed.`);
  if (!transactions.length) warnings.push("No completed transactions found in this file.");
  return { institution: "REVOLUT", transactions, balances, skipped, warnings };
}
