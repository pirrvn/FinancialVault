import { describe, expect, it, vi } from "vitest";
import type { TransactionDTO } from "@/lib/services/queries";

vi.mock("server-only", () => ({}));

// Scripted fake of ai.models.generateContentStream: round 1 calls a tool, round 2 answers.
const calls: { contents: { role: string; parts: Record<string, unknown>[] }[] }[] = [];
const toolCallPart = {
  functionCall: {
    id: "fc_1",
    name: "query_transactions",
    args: { start_date: "2026-09-01", end_date: "2026-09-30", categories: ["dining out"], group_by: "bank" },
  },
  thoughtSignature: "sig-abc",
};
const script = [
  [{ candidates: [{ content: { role: "model", parts: [toolCallPart] }, finishReason: "STOP" }] }],
  [
    { candidates: [{ content: { role: "model", parts: [{ text: "You spent **€60.00** " }] } }] },
    { candidates: [{ content: { role: "model", parts: [{ text: "on dining out." }] }, finishReason: "STOP" }] },
  ],
];
vi.mock("@/lib/ai/client", () => ({
  AI_MODEL: "gemini-test",
  describeAiFailure: () => "x",
  getGemini: () => ({
    models: {
      generateContentStream: async (params: { contents: { role: string; parts: Record<string, unknown>[] }[] }) => {
        calls.push({ contents: structuredClone(params.contents) });
        const chunks = script[calls.length - 1];
        return (async function* () {
          yield* chunks;
        })();
      },
    },
  }),
}));

const { runCopilot } = await import("@/lib/ai/copilot");

const tx = (over: Partial<TransactionDTO>): TransactionDTO => ({
  id: Math.random().toString(36),
  date: "2026-09-10",
  amountCents: -2000,
  currency: "EUR",
  merchantKey: "X",
  merchantName: "X",
  categoryId: "dining",
  categoryName: "Dining Out",
  kind: "EXPENSE",
  accountId: "a",
  rawDescription: "X",
  accountName: "A",
  institution: "REVOLUT",
  categorySource: "RULE",
  confidence: 1,
  needsReview: false,
  note: null,
  ...over,
});

describe("copilot loop", () => {
  it("executes tools against the user's data and streams the final answer", async () => {
    const data = {
      baseCurrency: "EUR",
      accounts: [],
      categories: [],
      transactions: [
        tx({ amountCents: -2500, institution: "REVOLUT" }),
        tx({ amountCents: -3500, institution: "CREDIT_AGRICOLE" }),
        tx({ amountCents: -9900, categoryName: "Groceries" }),
        tx({ amountCents: -1000, date: "2026-08-31" }),
      ],
    };
    const events = [];
    for await (const e of runCopilot([{ role: "user", content: "How much on dining out this month?" }], data)) events.push(e);

    expect(events).toEqual([
      { type: "tool", name: "query_transactions", label: "Querying transactions" },
      { type: "text", text: "You spent **€60.00** " },
      { type: "text", text: "on dining out." },
      { type: "done" },
    ]);
    // Second request replays the model turn unchanged (thought signature included) and carries the tool result.
    const second = calls[1].contents;
    expect(second[0]).toEqual({ role: "user", parts: [{ text: "How much on dining out this month?" }] });
    expect(second[1]).toEqual({ role: "model", parts: [toolCallPart] });
    const fr = second[2].parts[0].functionResponse as { id: string; name: string; response: { output: Record<string, unknown> } };
    expect(fr.id).toBe("fc_1");
    expect(fr.name).toBe("query_transactions");
    const out = fr.response.output as { match_count: number; money_out: string; groups: { key: string }[] };
    expect(out.match_count).toBe(2);
    expect(out.money_out).toBe("€60.00");
    expect(out.groups.map((g) => g.key).sort()).toEqual(["CREDIT_AGRICOLE", "REVOLUT"]);
  });
});
