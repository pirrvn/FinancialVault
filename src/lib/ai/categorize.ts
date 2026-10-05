import { z } from "zod";
import { AI_MODEL, describeAiFailure, getGemini } from "./client";

export interface AiCategoryOption {
  name: string;
  kind: "EXPENSE" | "INCOME" | "TRANSFER";
  description: string;
}

export interface AiCategorizationInput {
  /** Normalized merchant key — one AI decision per merchant, not per transaction. */
  merchantKey: string;
  sampleDescriptions: string[];
  direction: "DEBIT" | "CREDIT";
  bank: string;
  typicalAmount: number;
  occurrences: number;
}

export interface AiCategorizationResult {
  merchantKey: string;
  direction: "DEBIT" | "CREDIT";
  category: string;
  confidence: number;
}

const SYSTEM_PROMPT = `You categorize personal bank transactions for a French/European user whose statements come from Revolut and Crédit Agricole.

Each item is one merchant (already normalized from raw statement text), with sample raw descriptions, the money direction, the bank, a typical amount in EUR and how often it occurs.

Rules:
- Pick exactly one category from the provided list for every item, and respect its kind: DEBIT items normally map to EXPENSE or TRANSFER categories, CREDIT items to INCOME or TRANSFER categories.
- Use your knowledge of French and European merchants, brands and banking jargon (CB = card payment, PRLV = direct debit, VIR = transfer, DAB/GAB = ATM, CPAM/mutuelle = health reimbursements).
- Transfers to/from a person's name are usually Transfers unless the amount and wording clearly indicate rent, salary, or a gift.
- confidence is your probability (0..1) that the category is right. Use < 0.6 when you are guessing from a generic or ambiguous string.`;

const BATCH_SIZE = 50;

const ResultSchema = z.object({
  results: z.array(z.object({ id: z.number().int(), category: z.string(), confidence: z.number() })),
});

/**
 * Tier 2 of the pipeline. Returns results only for items the model answered; callers must
 * treat anything missing as unresolved (the deterministic fallback tier then takes over).
 */
export async function categorizeWithAi(items: AiCategorizationInput[], categories: AiCategoryOption[]): Promise<AiCategorizationResult[]> {
  if (!items.length) return [];
  const ai = getGemini();
  const names = categories.map((c) => c.name);
  const categoryList = categories.map((c) => `- ${c.name} [${c.kind}]: ${c.description}`).join("\n");
  const out: AiCategorizationResult[] = [];

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const payload = batch.map((item, i) => ({
      id: i,
      merchant: item.merchantKey,
      samples: item.sampleDescriptions.slice(0, 3),
      direction: item.direction,
      bank: item.bank,
      typical_amount_eur: Math.round(item.typicalAmount * 100) / 100,
      occurrences: item.occurrences,
    }));
    const response = await ai.models.generateContent({
      model: AI_MODEL,
      contents: `Categorize these ${batch.length} merchants. Return one result per id.\n\n${JSON.stringify(payload)}`,
      config: {
        systemInstruction: `${SYSTEM_PROMPT}\n\nCategories:\n${categoryList}`,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  category: { type: "string", enum: names },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["id", "category", "confidence"],
              },
            },
          },
          required: ["results"],
        },
      },
    });
    const parsed = ResultSchema.safeParse(safeJson(response.text));
    if (!parsed.success) continue;
    for (const r of parsed.data.results) {
      const item = batch[r.id];
      if (!item || !names.includes(r.category)) continue;
      out.push({ merchantKey: item.merchantKey, direction: item.direction, category: r.category, confidence: Math.max(0, Math.min(1, r.confidence)) });
    }
  }
  return out;
}

export function safeJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function describeAiError(err: unknown): string {
  return `AI categorization skipped: ${describeAiFailure(err)}.`;
}
