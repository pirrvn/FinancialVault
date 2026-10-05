import { foldText } from "../text";
import { decodeStatement } from "./csv";
import { parseCreditAgricole } from "./credit-agricole";
import { extractPdfItems, parseCreditAgricolePdfItems, type PdfParseResult } from "./credit-agricole-pdf";
import { parseRevolut } from "./revolut";
import { StatementParseError, type InstitutionId, type ParseResult } from "./types";

export * from "./types";
export { merchantKey } from "../categorization/merchant";

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // "%PDF"
}

export function detectInstitution(text: string, fileName = ""): InstitutionId | null {
  const head = foldText(text.slice(0, 4000));
  const name = foldText(fileName);
  if (/STARTED DATE|COMPLETED DATE|DATE DE DEBUT.*DATE DE FIN|PAID OUT \(/.test(head) || name.includes("REVOLUT")) return "REVOLUT";
  if (/LIBELLE/.test(head) || /CREDIT AGRICOLE|SOLDE AU \d{2}\/\d{2}\/\d{4}/.test(head) || (name.includes("CA") && name.includes("OPERATION")))
    return "CREDIT_AGRICOLE";
  return null;
}

export interface PdfFallback {
  available: boolean;
  extract: (bytes: Uint8Array) => Promise<PdfParseResult>;
  describeError: (err: unknown) => string;
}

/**
 * CSV → Revolut / Crédit Agricole parsers. PDF → Crédit Agricole statement reader, which must
 * reconcile against the printed balances; otherwise the AI reader (if configured) takes over,
 * and its result must reconcile too. A statement that doesn't add up is never imported silently.
 */
export async function parseStatement(bytes: Uint8Array, fileName: string, institution?: InstitutionId | null, pdfFallback?: PdfFallback): Promise<ParseResult> {
  if (isPdf(bytes)) {
    if (institution === "REVOLUT") throw new StatementParseError("Revolut PDFs aren't supported. Export the Revolut statement as CSV (Excel) instead.");
    return parseStatementPdf(bytes, fileName, pdfFallback);
  }
  const text = decodeStatement(bytes);
  const detected = institution ?? detectInstitution(text, fileName);
  if (detected === "REVOLUT") return parseRevolut(text);
  if (detected === "CREDIT_AGRICOLE") return parseCreditAgricole(text);
  throw new StatementParseError(`Could not recognize "${fileName}" as a Revolut CSV or a Crédit Agricole CSV/PDF statement.`);
}

async function parseStatementPdf(bytes: Uint8Array, fileName: string, fallback?: PdfFallback): Promise<ParseResult> {
  let local: PdfParseResult | null = null;
  try {
    local = parseCreditAgricolePdfItems(await extractPdfItems(bytes));
  } catch {
    local = null; // unreadable/encrypted text layer: let the AI try
  }
  if (local && local.transactions.length > 0 && local.reconciled !== false) return local;

  const why =
    !local || !local.transactions.length ? "no operations could be read from it" : `its totals don't add up (${local.reconciliationDetail.join("; ")})`;
  if (!fallback?.available) {
    throw new StatementParseError(
      `"${fileName}": ${why}. Set GEMINI_API_KEY to let the AI read unusual or scanned statements, or export operations as CSV if your bank offers it.`,
    );
  }
  let ai: PdfParseResult;
  try {
    ai = await fallback.extract(bytes);
  } catch (err) {
    throw new StatementParseError(`"${fileName}": ${why}, and the AI reader failed: ${fallback.describeError(err)}.`);
  }
  if (!ai.transactions.length) throw new StatementParseError(`"${fileName}": no operations found, even with the AI reader.`);
  if (ai.reconciled === false) {
    throw new StatementParseError(
      `"${fileName}": the AI reading doesn't match the statement's balances (${ai.reconciliationDetail.join("; ")}). Nothing was imported.`,
    );
  }
  if (ai.reconciled === null) ai.warnings.push("The statement's balances weren't found, so totals couldn't be double-checked.");
  return ai;
}
