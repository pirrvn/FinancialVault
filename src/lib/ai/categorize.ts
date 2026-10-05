import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK_BETA, getAnthropic, isMissingCredentials } from "./client";

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

function buildSchema(categoryNames: string[]) {
  return z.object({
    results: z.array(
      z.object({
        id: z.number().int(),
        category: z.enum(categoryNames as [string, ...string[]]),
        confidence: z.number(),
      }),
    ),
  });
}

/**
 * Tier 2 of the pipeline. Returns results only for items the model answered; callers must
 * treat anything missing as unresolved (the deterministic fallback tier then takes over).
 */
export async function categorizeWithAi(items: AiCategorizationInput[], categories: AiCategoryOption[]): Promise<AiCategorizationResult[]> {
  if (!items.length) return [];
  const client = getAnthropic();
  const names = categories.map((c) => c.name);
  const schema = buildSchema(names);
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
    const message = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(schema) },
      system: [{ type: "text", text: `${SYSTEM_PROMPT}\n\nCategories:\n${categoryList}`, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Categorize these ${batch.length} merchants. Return one result per id.\n\n${JSON.stringify(payload)}` }],
    });
    if (message.stop_reason === "refusal" || !message.parsed_output) continue;
    for (const r of message.parsed_output.results) {
      const item = batch[r.id];
      if (!item) continue;
      out.push({ merchantKey: item.merchantKey, direction: item.direction, category: r.category, confidence: Math.max(0, Math.min(1, r.confidence)) });
    }
  }
  return out;
}

export function describeAiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError || isMissingCredentials(err))
    return "AI categorization skipped: Anthropic credentials are missing or invalid.";
  if (err instanceof Anthropic.RateLimitError) return "AI categorization skipped: rate limited by the Anthropic API.";
  if (err instanceof Anthropic.APIConnectionError) return "AI categorization skipped: could not reach the Anthropic API.";
  if (err instanceof Anthropic.APIError) return `AI categorization skipped: Anthropic API error ${err.status ?? ""}.`.trim();
  return "AI categorization skipped due to an unexpected error.";
}
