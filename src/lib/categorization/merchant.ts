import { foldText, titleCase } from "../text";

/**
 * Bank-specific noise that wraps the actual merchant in statement descriptions.
 * Crédit Agricole examples:
 *   "CB CARREFOUR CITY 12/03"            -> "CARREFOUR CITY"
 *   "PAIEMENT PAR CARTE X1234 AMAZON PAYMENTS 15/03" -> "AMAZON PAYMENTS"
 *   "PRLV SEPA FREE MOBILE REF:XYZ123"   -> "FREE MOBILE"
 *   "VIR SEPA RECU /DE JEAN DUPONT /MOTIF LOYER" -> "JEAN DUPONT"
 * Revolut descriptions are usually already clean ("Uber", "To EUR Savings").
 */
const PREFIXES: RegExp[] = [
  /^PAIEMENT PAR CARTE( X?\d{4})?( \d{2}\/\d{2}(\/\d{2,4})?)?\s+/,
  /^PAIEMENT CB( \d{2}\/\d{2}(\/\d{2,4})?)?\s+/,
  /^ACHAT CB\s+/,
  /^CARTE X?\d{4}( \d{2}\/\d{2}(\/\d{2,4})?)?\s+/,
  /^CB\*?\s*/,
  /^PRLV SEPA\s+/,
  /^PRELEVEMENT( SEPA)?( EUROPEEN)?\s+/,
  /^PRELEVMNT\s+/,
  /^ECHEANCE PRET\s+/,
  /^VIR(EMENT)?( SEPA)?( INST(ANTANE)?)?( RECU| EMIS)?( WEB)?\s+(\/?DE\s+|\/?A\s+|POUR\s+)?/,
  /^AVOIR (CB|CARTE)\s+/,
  /^REMBOURSEMENT( CB)?\s+/,
  /^COTISATION\s+/,
  /^FRAIS\s+/,
  /^\/?DE:?\s+/,
];

const NOISE: RegExp[] = [
  /\b(REF|REFERENCE|ID|NUM|DATE|LIB)\s*[:.]\s*\S+/g, // "REF: XYZ123" style fields
  /\b(MOTIF|MDT|RUM|ICS|ECH|ID EMETTEUR|EMETTEUR)\b.*$/g, // SEPA mandate / remittance / due-date blocks run to the end
  /\/(MOTIF|REF|ID|DE|A|LIB)\b.*$/g, // trailing structured SEPA blocks
  /\b(CARTE )?X\d{4}\b/g, // masked card numbers
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // dates
  /\b\d{1,2}H\d{2}\b/g, // times
  /\b\d{5,}\b/g, // long numeric references
  /\b[A-Z]*\d+[A-Z\d]*\d+[A-Z\d]*\b/g, // mixed alnum codes with >=2 digits (e.g. FR12345ABC, 4DE2F)
  /\*+/g,
  /[#:;,_|()[\]{}"'+=]/g,
  /\b(SAS|SARL|SA|EURL|SNC|LTD|GMBH|INC|BV|FR|PARIS|LYON|MARSEILLE|FRANCE)\b/g,
  /\bWWW\.|\.(COM|FR|EU|NET|ORG|IO|CO)\b/g,
];

/** Strip bank noise and return the canonical merchant key (upper-case, accent-free, <= 4 tokens). */
export function merchantKey(rawDescription: string): string {
  let s = foldText(rawDescription);
  // Prefixes can stack ("CB CARTE X1234 ..."), so apply until stable.
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const p of PREFIXES) s = s.replace(p, "");
    if (s === before) break;
  }
  for (const n of NOISE) s = s.replace(n, " ");
  s = s
    .replace(/[-./\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = s.split(" ").filter((t) => t.length > 1 || /\d/.test(t));
  const key = tokens.slice(0, 4).join(" ");
  // Never return an empty key: fall back to the folded description.
  return key || foldText(rawDescription).slice(0, 40) || "UNKNOWN";
}

/**
 * Display label for a merchant. Clean, mixed-case bank descriptions (typical of Revolut: "Uber Eats",
 * "iCloud+") keep their original casing; noisy all-caps statement text is title-cased from the key.
 */
export function merchantDisplayName(key: string, rawDescription?: string): string {
  const raw = rawDescription?.replace(/\s+/g, " ").trim();
  if (raw && raw !== raw.toUpperCase() && foldText(raw).startsWith(key)) {
    return raw.slice(0, key.length).trim();
  }
  return titleCase(key);
}
