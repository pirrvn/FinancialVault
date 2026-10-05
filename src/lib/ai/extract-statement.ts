import { z } from "zod";
import { parseFrenchDate, parseIsoDate } from "../dates";
import type { ParsedTransaction } from "../parsers/types";
import type { PdfParseResult } from "../parsers/credit-agricole-pdf";
import { AI_MODEL, getGemini } from "./client";
import { safeJson } from "./categorize";

const Extracted = z.object({
  accounts: z.array(
    z.object({
      account_name: z.string(),
      account_number: z.string().nullable().optional(),
      opening_balance: z.number().nullable().optional(),
      closing_balance: z.number().nullable().optional(),
      closing_date: z.string().nullable().optional(),
      transactions: z.array(z.object({ date: z.string(), value_date: z.string().nullable().optional(), label: z.string(), amount: z.number() })),
    }),
  ),
});

const PROMPT = `This is a Crédit Agricole bank statement (relevé de compte) in French.
Extract every operation of every account, exactly as printed:
- date: the operation date ("Date opé.") as YYYY-MM-DD. Infer the year from the statement period; December operations on a January statement belong to the previous year.
- value_date: the "Date valeur" as YYYY-MM-DD (omit if absent).
- label: the full operation label, joining wrapped lines with a space.
- amount: a number in euros, NEGATIVE for the Débit column and POSITIVE for the Crédit column.
Also give each account's opening balance ("Ancien solde") and closing balance ("Nouveau solde") as signed numbers (débiteur = negative), and the closing date as YYYY-MM-DD.
Do not include balance lines or "Total des opérations" lines as operations. Do not invent or round anything.`;

/**
 * Fallback for statements the layout parser can't read reliably (unusual layout or a scanned PDF).
 * The result is reconciled against the printed balances exactly like the deterministic parser.
 */
export async function extractStatementWithAi(bytes: Uint8Array): Promise<PdfParseResult> {
  const response = await getGemini().models.generateContent({
    model: AI_MODEL,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(bytes).toString("base64") } }, { text: PROMPT }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        properties: {
          accounts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                account_name: { type: "string" },
                account_number: { type: "string" },
                opening_balance: { type: "number" },
                closing_balance: { type: "number" },
                closing_date: { type: "string" },
                transactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { date: { type: "string" }, value_date: { type: "string" }, label: { type: "string" }, amount: { type: "number" } },
                    required: ["date", "label", "amount"],
                  },
                },
              },
              required: ["account_name", "transactions"],
            },
          },
        },
        required: ["accounts"],
      },
    },
  });
  const parsed = Extracted.safeParse(safeJson(response.text));
  if (!parsed.success) throw new Error("The AI couldn't read this statement.");

  const toDate = (s: string | null | undefined) => (s ? (parseIsoDate(s) ?? parseFrenchDate(s)) : null);
  const transactions: ParsedTransaction[] = [];
  const balances: PdfParseResult["balances"] = {};
  const detail: string[] = [];
  let reconciled: boolean | null = null;
  let skipped = 0;

  for (const a of parsed.data.accounts) {
    const number = a.account_number?.replace(/\D/g, "") || null;
    const ref = number ? `ACC-${number}` : "DEFAULT";
    const label = `Crédit Agricole · ${a.account_name.trim() || "Compte"}${number ? ` ••${number.slice(-4)}` : ""}`;
    let sum = 0;
    for (const t of a.transactions) {
      const date = toDate(t.date);
      const cents = Math.round(t.amount * 100);
      if (!date || !cents || !t.label.trim()) {
        skipped++;
        continue;
      }
      sum += cents;
      transactions.push({
        date,
        valueDate: toDate(t.value_date),
        amountCents: cents,
        currency: "EUR",
        rawDescription: t.label.replace(/\s+/g, " ").trim(),
        bankType: null,
        accountRef: ref,
        accountLabel: label,
      });
    }
    const opening = a.opening_balance ?? null;
    const closing = a.closing_balance ?? null;
    const closingDate = toDate(a.closing_date);
    if (closing !== null && closingDate) balances[ref] = { cents: Math.round(closing * 100), asOf: closingDate };
    if (opening !== null && closing !== null) {
      const ok = Math.round(opening * 100) + sum === Math.round(closing * 100);
      reconciled = (reconciled ?? true) && ok;
      detail.push(`${label}: ${opening.toFixed(2)} + ${(sum / 100).toFixed(2)} ${ok ? "=" : "≠"} ${closing.toFixed(2)}`);
    }
  }
  return {
    institution: "CREDIT_AGRICOLE",
    transactions,
    balances,
    skipped,
    warnings: ["This statement was read by AI (Gemini). Spot-check a few amounts."],
    reconciled,
    reconciliationDetail: detail,
  };
}
