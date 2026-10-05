import { parseAmountToCents } from "../money";
import { utcDate } from "../dates";
import { foldText } from "../text";
import type { ParseResult, ParsedTransaction } from "./types";

/**
 * Crédit Agricole PDF statement ("Relevé de compte").
 *
 * The PDF has no table structure, only positioned text, so we rebuild it:
 *   - group text items into lines by their y position,
 *   - locate the "Débit" / "Crédit" column headers to know which side an amount sits on,
 *   - start a transaction on each line beginning with a DD.MM date, append the following
 *     indented lines to its label,
 *   - read "Ancien solde" / "Nouveau solde" and reconcile: old + Σ operations must equal new.
 * Operation dates have no year ("05.02"); it's inferred from the statement's closing date.
 */

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

export interface PdfParseResult extends ParseResult {
  /** true: every account reconciled to the cent. false: a mismatch. null: no balances to check. */
  reconciled: boolean | null;
  reconciliationDetail: string[];
}

interface Line {
  page: number;
  y: number;
  items: PdfTextItem[];
  text: string;
  folded: string;
}

interface Columns {
  debitX: number;
  creditX: number;
  labelX: number;
}

interface AccountState {
  ref: string;
  label: string;
  opening: number | null;
  closing: { cents: number; asOf: Date | null } | null;
  sum: number;
  count: number;
}

const DATE_SHORT = /^(\d{2})[./](\d{2})$/;
const DATE_FULL = /(\d{2})[./](\d{2})[./](\d{4})/;
const AMOUNT = /^\d{1,3}(?:[ .  ]\d{3})*,\d{2}$/;
const FR_MONTHS = ["JANVIER", "FEVRIER", "MARS", "AVRIL", "MAI", "JUIN", "JUILLET", "AOUT", "SEPTEMBRE", "OCTOBRE", "NOVEMBRE", "DECEMBRE"];

const center = (i: PdfTextItem) => i.x + i.width / 2;

/** Strip glyph markers some statements print next to amounts (e.g. "¨", "þ", "€"). */
function cleanAmountText(s: string): string {
  return s.replace(/[^\d,.\s  ]/g, "").trim();
}

function groupLines(pages: PdfTextItem[][]): Line[] {
  const lines: Line[] = [];
  pages.forEach((items, page) => {
    const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    let current: PdfTextItem[] = [];
    let currentY = Number.NaN;
    const flush = () => {
      if (!current.length) return;
      // Some PDFs emit one item per glyph: glue touching items back into words.
      const ordered: PdfTextItem[] = [];
      for (const item of current.sort((a, b) => a.x - b.x)) {
        const prev = ordered[ordered.length - 1];
        if (prev && item.x - (prev.x + prev.width) < 0.8 && !/\s$/.test(prev.str)) {
          ordered[ordered.length - 1] = { ...prev, str: prev.str + item.str, width: item.x + item.width - prev.x };
        } else ordered.push({ ...item });
      }
      const text = ordered.map((i) => i.str.trim()).join(" ");
      lines.push({ page, y: currentY, items: ordered, text, folded: foldText(text) });
      current = [];
    };
    for (const item of sorted) {
      if (current.length && Math.abs(item.y - currentY) > 2.5) flush();
      if (!current.length) currentY = item.y;
      current.push(item);
    }
    flush();
  });
  return lines;
}

/** Merge items that together form one amount ("1" + "234,56") and return the rightmost amount, if any. */
function trailingAmount(items: PdfTextItem[]): { cents: number; item: PdfTextItem; consumed: number } | null {
  for (let end = items.length - 1; end >= 0 && end >= items.length - 3; end--) {
    const last = cleanAmountText(items[end].str);
    if (!last) continue;
    let text = last;
    let start = end;
    // Join a preceding thousands group when the PDF split the number into two items.
    while (start > 0 && /^\d{1,3}$/.test(cleanAmountText(items[start - 1].str)) && items[start].x - (items[start - 1].x + items[start - 1].width) < 8) {
      text = `${cleanAmountText(items[start - 1].str)} ${text}`;
      start--;
    }
    if (AMOUNT.test(text)) {
      const merged: PdfTextItem = { str: text, x: items[start].x, y: items[start].y, width: items[end].x + items[end].width - items[start].x };
      return { cents: parseAmountToCents(text)!, item: merged, consumed: items.length - start };
    }
    // Only skip trailing pure-symbol items (markers); anything else means no amount on this line.
    if (/[\p{L}\d]/u.test(items[end].str)) return null;
  }
  return null;
}

function findStatementEnd(lines: Line[]): Date | null {
  const candidates: Date[] = [];
  for (const l of lines) {
    const arrete = l.folded.match(/DATE D'?\s?ARRETE\s*:?\s*(\d{1,2})\s+([A-Z]+)\s+(\d{4})/);
    if (arrete) {
      const m = FR_MONTHS.indexOf(arrete[2]);
      const d = m >= 0 ? utcDate(Number(arrete[3]), m + 1, Number(arrete[1])) : null;
      if (d) candidates.push(d);
    }
    if (/SOLDE|ARRETE|RELEVE|PERIODE|\bAU\b/.test(l.folded)) {
      for (const m of l.folded.matchAll(new RegExp(DATE_FULL, "g"))) {
        const d = utcDate(Number(m[3]), Number(m[2]), Number(m[1]));
        if (d) candidates.push(d);
      }
    }
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b > a ? b : a));
}

function resolveYear(day: number, month: number, end: Date): Date | null {
  const endMonth = end.getUTCMonth() + 1;
  // Operations are on or before the closing date; a later month means the previous year (Dec ops on a Jan statement).
  const year = month < endMonth || (month === endMonth && day <= end.getUTCDate() + 7) ? end.getUTCFullYear() : end.getUTCFullYear() - 1;
  return utcDate(year, month, day);
}

function readColumns(line: Line): Columns | null {
  const debit = line.items.find((i) => foldText(i.str).startsWith("DEBIT"));
  const credit = line.items.find((i) => foldText(i.str).startsWith("CREDIT"));
  if (!debit || !credit) return null;
  const label = line.items.find((i) => foldText(i.str).startsWith("LIBELLE"));
  return { debitX: center(debit), creditX: center(credit), labelX: label?.x ?? debit.x / 2 };
}

const IGNORE = /^(PAGE \d|TOTAL DES OPERATIONS|SOUS TOTAL|MONTANT|SUITE AU VERSO|REPORT|\d+\s*\/\s*\d+$)/;

export function parseCreditAgricolePdfItems(pages: PdfTextItem[][]): PdfParseResult {
  const lines = groupLines(pages);
  const end = findStatementEnd(lines);
  const warnings: string[] = [];
  const transactions: ParsedTransaction[] = [];
  const accounts: AccountState[] = [];
  let columns: Columns | null = null;
  let account: AccountState | null = null;
  let open: { tx: ParsedTransaction; line: Line } | null = null;
  let skipped = 0;

  const ensureAccount = () => {
    if (!account) {
      account = { ref: "DEFAULT", label: "Crédit Agricole · Compte courant", opening: null, closing: null, sum: 0, count: 0 };
      accounts.push(account);
    }
    return account;
  };
  const sideOf = (item: PdfTextItem) => (columns ? (Math.abs(center(item) - columns.debitX) <= Math.abs(center(item) - columns.creditX) ? -1 : 1) : 0);

  for (const line of lines) {
    const f = line.folded;

    // Account section header, e.g. "Compte de Dépôt carte n° 12345678901" or "LIVRET A N° 987654321".
    // Not while a transaction is open, and never on a dated line: "VIR VERS LIVRET A N° 123…" is an operation.
    const acc = f.match(/^(.*?\b(?:COMPTE|LIVRET|CCHQ|PEL|LDD|LEP|EPARGNE|CEL)\b.*?)\bN\s*[°O]?\s*:?\s*(\d[\d ]{6,}\d)/);
    if (acc && !open && !/SOLDE/.test(f) && !DATE_SHORT.test(line.items[0]?.str.trim() ?? "")) {
      const number = acc[2].replace(/\s/g, "");
      const ref = `ACC-${number}`;
      account = accounts.find((a) => a.ref === ref) ?? null;
      if (!account) {
        const raw = line.text
          .slice(0, line.text.search(/n[°o]?\s*:?\s*\d/i))
          .replace(/\s+/g, " ")
          .trim();
        account = { ref, label: `Crédit Agricole · ${raw || "Compte"} ••${number.slice(-4)}`, opening: null, closing: null, sum: 0, count: 0 };
        accounts.push(account);
      }
      open = null;
      continue;
    }

    const cols = readColumns(line);
    if (cols) {
      columns = cols;
      open = null;
      continue;
    }

    const solde = f.match(/(ANCIEN|NOUVEAU) SOLDE( CREDITEUR| DEBITEUR)?/);
    if (solde) {
      const amt = trailingAmount(line.items);
      if (amt) {
        const a = ensureAccount();
        const negative = solde[2] === " DEBITEUR" || (!solde[2] && sideOf(amt.item) < 0);
        const cents = negative ? -amt.cents : amt.cents;
        if (solde[1] === "ANCIEN") a.opening = cents;
        else {
          const dm = f.match(DATE_FULL);
          a.closing = { cents, asOf: dm ? utcDate(Number(dm[3]), Number(dm[2]), Number(dm[1])) : end };
        }
      }
      open = null;
      continue;
    }

    if (IGNORE.test(f)) {
      open = null;
      continue;
    }

    const first = line.items[0]?.str.trim() ?? "";
    const dm = first.match(DATE_SHORT);
    if (dm && columns && end) {
      const date = resolveYear(Number(dm[1]), Number(dm[2]), end);
      let idx = 1;
      let valueDate: Date | null = null;
      const vm = line.items[1]?.str.trim().match(DATE_SHORT);
      if (vm) {
        valueDate = resolveYear(Number(vm[1]), Number(vm[2]), end);
        idx = 2;
      }
      const amt = trailingAmount(line.items);
      const labelItems = line.items.slice(idx, amt ? line.items.length - amt.consumed : undefined);
      const label = labelItems.map((i) => i.str.trim()).join(" ");
      if (!date || !label) {
        skipped++;
        continue;
      }
      const a = ensureAccount();
      const tx: ParsedTransaction = {
        date,
        valueDate,
        amountCents: amt ? amt.cents * sideOf(amt.item) : 0,
        currency: "EUR",
        rawDescription: label,
        bankType: null,
        accountRef: a.ref,
        accountLabel: a.label,
      };
      transactions.push(tx);
      open = { tx, line };
      continue;
    }

    // Continuation of the previous operation's label (indented, directly below, same page).
    if (open && columns && line.page === open.line.page && open.line.y - line.y < 30 && (line.items[0]?.x ?? 0) >= columns.labelX - 8) {
      const amt = trailingAmount(line.items);
      const rest = amt ? line.items.slice(0, line.items.length - amt.consumed) : line.items;
      if (amt && open.tx.amountCents === 0) open.tx.amountCents = amt.cents * sideOf(amt.item);
      const extra = rest.map((i) => i.str.trim()).join(" ");
      if (extra) open.tx.rawDescription = `${open.tx.rawDescription} ${extra}`.replace(/\s+/g, " ").trim();
      open.line = line;
      continue;
    }
    open = null;
  }

  // Operations without an amount can't be imported safely.
  const valid = transactions.filter((t) => t.amountCents !== 0);
  skipped += transactions.length - valid.length;
  for (const t of valid) {
    const a = accounts.find((x) => x.ref === t.accountRef)!;
    a.sum += t.amountCents;
    a.count++;
  }

  const detail: string[] = [];
  let reconciled: boolean | null = null;
  for (const a of accounts) {
    if (a.opening === null || !a.closing) continue;
    const ok = a.opening + a.sum === a.closing.cents;
    reconciled = (reconciled ?? true) && ok;
    detail.push(`${a.label}: ${(a.opening / 100).toFixed(2)} + ${(a.sum / 100).toFixed(2)} ${ok ? "=" : "≠"} ${(a.closing.cents / 100).toFixed(2)}`);
  }
  if (!end) warnings.push("Couldn't find the statement date, so operation years are unknown.");
  if (!columns) warnings.push("Couldn't find the Débit / Crédit columns.");
  if (reconciled === null && valid.length) warnings.push("The statement's opening/closing balances weren't found, so totals couldn't be double-checked.");

  const balances: ParseResult["balances"] = {};
  for (const a of accounts) if (a.closing) balances[a.ref] = { cents: a.closing.cents, asOf: a.closing.asOf ?? end ?? new Date() };

  return { institution: "CREDIT_AGRICOLE", transactions: valid, balances, skipped, warnings, reconciled, reconciliationDetail: detail };
}

export async function extractPdfItems(bytes: Uint8Array): Promise<PdfTextItem[][]> {
  const { extractTextItems } = await import("unpdf");
  // pdf.js transfers (detaches) the buffer it's given, so hand it a copy.
  const { items } = await extractTextItems(new Uint8Array(bytes));
  return items.map((page) => page.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width })));
}
