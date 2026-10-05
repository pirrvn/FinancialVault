import { foldText, titleCase } from "../text";

/**
 * Bank-specific noise that wraps the actual merchant in statement descriptions.
 * Crédit Agricole examples:
 *   "CB CARREFOUR CITY 12/03"            -> "CARREFOUR CITY"
 *   "PAIEMENT PAR CARTE X1234 AMAZON PAYMENTS 15/03" -> "AMAZON PAYMENTS"
 *   "PRLV SEPA FREE MOBILE REF:XYZ123"   -> "FREE MOBILE"
 *   "VIR SEPA RECU /DE JEAN DUPONT /MOTIF LOYER" -> "JEAN DUPONT"
 * Current Crédit Agricole PDF statements (mixed case, folded before matching):
 *   "Carte X2416 Le Xvi Balto Paris 12/04"        -> "LE XVI BALTO"
 *   "Carte X2416 Sq *noir Coffee Shop 25/04"      -> "NOIR COFFEE SHOP"   (payment processor prefix)
 *   "Carte X2416 MONOP4801 Paris 24/04"           -> "MONOP"              (store number)
 *   "Virement Vir Inst Wero de Mr Jean Dupont"    -> "JEAN DUPONT"
 *   "Prlv Prixtel" -> "PRIXTEL", "Cotis ** Offre Essentiel" -> "OFFRE ESSENTIEL"
 * Revolut descriptions are usually already clean ("Uber", "To EUR Savings").
 */
const PREFIXES: RegExp[] = [
  /^PAIEMENT PAR CARTE( X?\d{4})?( \d{2}\/\d{2}(\/\d{2,4})?)?\s+/,
  /^PAIEMENT CB( \d{2}\/\d{2}(\/\d{2,4})?)?\s+/,
  /^ACHAT CB\s+/,
  /^CARTE X?\d{4}( \d{2}\/\d{2}(\/\d{2,4})?)?\s+/,
  /^CB\*?\s*/,
  /^PRLV( SEPA)?\s+/,
  /^PRELEVEMENT( SEPA)?( EUROPEEN)?\s+/,
  /^PRELEVMNT\s+/,
  /^ECHEANCE PRET\s+/,
  /^VIR(EMENT)?( SEPA)?( INST(ANTANE)?)?( RECU| EMIS)?( WEB)?\s+(\/?DE\s+|\/?A\s+|POUR\s+|VERS\s+)?/,
  /^(WERO|PAYLIB|LYDIA)( DE| VERS| A)?\s+/,
  // Card processors / marketplaces in front of the real merchant: "SQ *NOIR COFFEE", "SUMUP *BAR", "UBR* PENDING.UBER.COM".
  /^(SQ|SUMUP|SUM UP|ZTL|IZ|UEP|NYX|LW|UBR|PAYPAL|PP|SMP|PY|TST|DRI|STRIPE)\s*\*\s*/,
  /^(MR|MME|MLLE|M|MONSIEUR|MADAME)\s+/,
  /^AVOIR (CB|CARTE)\s+/,
  /^REMBOURSEMENT( CB)?\s+/,
  /^COTIS(ATION)?( \*+)?\s+/,
  /^FRAIS\s+/,
  /^(\/?DE:?|VERS)\s+/,
];

const NOISE: RegExp[] = [
  /\b(REF|REFERENCE|ID|NUM|DATE|LIB)\s*[:.]\s*\S+/g, // "REF: XYZ123" style fields
  /\b(SCOR|MOTIF|MDT|RUM|ICS|ECH|ID EMETTEUR|EMETTEUR)\b.*$/g, // SEPA creditor reference / mandate / remittance / due-date blocks run to the end
  /\b(JANV?|JANVIER|FEVR?|FEVRIER|FEB|MARS?|AVR|AVRIL|APR|MAI|MAY|JUIN?|JUL|JUIL|JUILLET|AOUT?|AUG|SEPT?|SEPTEMBRE|OCT|OCTOBRE|NOV|NOVEMBRE|DEC|DECEMBRE) ?20\d{2}\b/g, // billing month ("JAN 2026")
  /\/(MOTIF|REF|ID|DE|A|LIB)\b.*$/g, // trailing structured SEPA blocks
  /\b(CARTE )?X\d{4}\b/g, // masked card numbers
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // dates
  /\b\d{1,2}H\d{2}\b/g, // times
  /\b\d{5,}\b/g, // long numeric references
  /\bPENDING\b/g, // pre-authorisation marker ("UBER * EATS PENDING")
  /\b[A-Z]*\d+[A-Z\d]*\d+[A-Z\d]*\b/g, // mixed alnum codes with >=2 digits (e.g. FR12345ABC, 4DE2F)
  /\*+/g,
  /[#:;,_|()[\]{}"'+=]/g,
  /\b(SAS|SARL|SA|EURL|SNC|LTD|GMBH|INC|BV|FR|PARIS|LYON|MARSEILLE|FRANCE)\b/g,
  /\bWWW\.|\.(COM|FR|EU|NET|ORG|IO|CO)\b/g,
];

/** Strip bank noise and return the canonical merchant key (upper-case, accent-free, <= 4 tokens). */
const MONTHS = new Set([
  "JAN",
  "JANV",
  "JANVIER",
  "FEV",
  "FEVR",
  "FEVRIER",
  "FEB",
  "MAR",
  "MARS",
  "AVR",
  "AVRIL",
  "APR",
  "MAI",
  "MAY",
  "JUN",
  "JUIN",
  "JUL",
  "JUIL",
  "JUILLET",
  "AOU",
  "AOUT",
  "AUG",
  "SEP",
  "SEPT",
  "SEPTEMBRE",
  "OCT",
  "OCTOBRE",
  "NOV",
  "NOVEMBRE",
  "DEC",
  "DECEMBRE",
]);

/** Money to or from a person: keep their initials ("BENJAMIN F" and "BENJAMIN L" are different people). */
const PERSON_TRANSFER = /\b(WERO|LYDIA|PAYLIB)\b|^VIR(EMENT)?( SEPA)?( INST)?( RECU| EMIS)? (VERS|DE) (MR|MME|M) /;

export function merchantKey(rawDescription: string): string {
  let s = foldText(rawDescription);
  const person = PERSON_TRANSFER.test(s);
  // Prefixes can stack ("CB CARTE X1234 ..."), so apply until stable.
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const p of PREFIXES) s = s.replace(p, "");
    if (s === before) break;
  }
  const afterPrefixes = s;
  // Per-ride descriptors ("LIME*2 COURSES 4LAF", "LIME*TRAJET") all mean the same merchant.
  s = s.replace(/^LIME\s*\*.*$/, "LIME");
  // Keep the brand of store-numbered names ("MONOP4801" -> "MONOP") before codes are stripped,
  // but not month stamps ("JAN2026"), which would split a monthly direct debit into twelve merchants.
  s = s.replace(/\b([A-Z]{3,})\d{2,}\b/g, (_, letters: string) => (MONTHS.has(letters) ? " " : letters));
  for (const n of NOISE) s = s.replace(n, " ");
  s = s
    .replace(/[-./\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Spaced-out names ("P H I S E R") become one word; lone letters ("L ARMANDIE") are dropped.
  s = s.replace(/\b[A-Z](?: [A-Z]\b){2,}/g, (m) => m.replace(/ /g, ""));
  // Pure numbers are amounts, times or references, never part of a stable merchant identity.
  let tokens = s.split(" ").filter((t) => (t.length > 1 || (person && /^[A-Z]$/.test(t))) && !/^\d+$/.test(t));
  // Short codes mixing letters and digits ("4LAF") only identify the merchant when nothing else does ("G20").
  const words = tokens.filter((t) => !(/\d/.test(t) && /[A-Z]/.test(t)));
  if (words.length) tokens = words;
  // Card descriptors truncate the city ("LA TERRASSE MIRA PAR" = "... PARIS").
  while (tokens.length > 1 && /^(PAR|PARI)$/.test(tokens[tokens.length - 1])) tokens.pop();
  const key = tokens.slice(0, 4).join(" ");
  if (key) return key;
  // Everything was a code ("G20 PARIS 12/04"): keep the codes, but never dates, times or plain numbers,
  // so the key stays stable from one month to the next.
  const fallback = afterPrefixes
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b|\b\d{1,2}H\d{2}\b/g, " ")
    .split(/[\s*]+/)
    .filter((t) => t.length > 1 && !/^[\d.,]+$/.test(t) && !/^X\d{4}$/.test(t));
  return fallback.slice(0, 4).join(" ") || "UNKNOWN";
}

/**
 * Display label for a merchant. Clean, mixed-case bank descriptions (typical of Revolut: "Uber Eats",
 * "iCloud+") keep their original casing; noisy all-caps statement text is title-cased from the key.
 */
export function merchantDisplayName(key: string, rawDescription?: string): string {
  const raw = rawDescription?.replace(/\s+/g, " ").trim();
  if (raw && raw !== raw.toUpperCase()) {
    // Reuse the bank's own spelling word by word ("Le Xvi Balto", "Prixtel"), capitalized.
    const original = new Map<string, string>();
    for (const w of raw.split(/[^\p{L}\p{N}]+/u)) if (w && !original.has(foldText(w))) original.set(foldText(w), w);
    const words = key.split(" ").map((k) => original.get(k));
    if (words.every(Boolean)) return words.map((w) => w![0].toUpperCase() + w!.slice(1)).join(" ");
  }
  return titleCase(key);
}
