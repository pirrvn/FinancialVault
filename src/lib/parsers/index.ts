import { foldText } from "../text";
import { decodeStatement } from "./csv";
import { parseCreditAgricole } from "./credit-agricole";
import { parseRevolut } from "./revolut";
import { StatementParseError, type InstitutionId, type ParseResult } from "./types";

export * from "./types";
export { merchantKey } from "../categorization/merchant";

export function detectInstitution(text: string, fileName = ""): InstitutionId | null {
  const head = foldText(text.slice(0, 4000));
  const name = foldText(fileName);
  if (/STARTED DATE|COMPLETED DATE|DATE DE DEBUT.*DATE DE FIN|PAID OUT \(/.test(head) || name.includes("REVOLUT")) return "REVOLUT";
  if (/LIBELLE/.test(head) || /CREDIT AGRICOLE|SOLDE AU \d{2}\/\d{2}\/\d{4}/.test(head) || (name.includes("CA") && name.includes("OPERATION")))
    return "CREDIT_AGRICOLE";
  return null;
}

export function parseStatement(bytes: Uint8Array, fileName: string, institution?: InstitutionId | null): ParseResult {
  const text = decodeStatement(bytes);
  const detected = institution ?? detectInstitution(text, fileName);
  if (detected === "REVOLUT") return parseRevolut(text);
  if (detected === "CREDIT_AGRICOLE") return parseCreditAgricole(text);
  throw new StatementParseError(`Could not recognize "${fileName}" as a Revolut or Crédit Agricole CSV statement.`);
}
