import { describe, expect, it, vi } from "vitest";
import type { TransactionDTO } from "@/lib/services/queries";

vi.mock("server-only", () => ({}));

// Scripted fake of client.beta.messages.stream: round 1 calls a tool, round 2 answers.
const calls: { messages: { role: string; content: unknown }[] }[] = [];
const script = [
  {
    events: [],
    final: {
      stop_reason: "tool_use",
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        {
          type: "tool_use",
          id: "tu_1",
          name: "query_transactions",
          input: { start_date: "2026-09-01", end_date: "2026-09-30", categories: ["dining out"], group_by: "bank" },
        },
      ],
    },
  },
  {
    events: [{ type: "content_block_delta", delta: { type: "text_delta", text: "You spent **€60.00** on dining out." } }],
    final: { stop_reason: "end_turn", content: [{ type: "text", text: "You spent **€60.00** on dining out." }] },
  },
];
vi.mock("@/lib/ai/client", () => ({
  isMissingCredentials: () => false,
  AI_MODEL: "claude-opus-5-5",
  FALLBACK_BETA: "server-side-fallback-2026-07-01",
  getAnthropic: () => ({
    beta: {
      messages: {
        stream: (params: { messages: { role: string; content: unknown }[] }) => {
          calls.push({ messages: structuredClone(params.messages) });
          const step = script[calls.length - 1];
          return {
            async *[Symbol.asyncIterator]() {
              yield* step.events;
            },
            finalMessage: async () => step.final,
          };
        },
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
      { type: "text", text: "You spent **€60.00** on dining out." },
      { type: "done" },
    ]);
    // Second request replays the assistant turn unchanged (thinking included) and carries the tool result.
    const second = calls[1].messages;
    expect(second[1]).toEqual({ role: "assistant", content: script[0].final.content });
    const result = (second[2].content as { type: string; content: string; is_error?: boolean }[])[0];
    expect(result.is_error).toBeUndefined();
    const parsed = JSON.parse(result.content);
    expect(parsed.match_count).toBe(2);
    expect(parsed.money_out).toBe("€60.00");
    expect(parsed.groups.map((g: { key: string }) => g.key).sort()).toEqual(["CREDIT_AGRICOLE", "REVOLUT"]);
  });
});
