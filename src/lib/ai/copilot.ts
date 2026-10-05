import "server-only";
import type { Content, FunctionCall, FunctionDeclaration, Part } from "@google/genai";
import { z } from "zod";
import { foldText } from "../text";
import { formatMoney } from "../money";
import { computeKpis, monthlySeries } from "../analytics/summary";
import { detectRecurring } from "../analytics/recurring";
import { merchantConcentration } from "../analytics/concentration";
import { findOpportunities } from "../analytics/opportunities";
import { buildBaseline, EMPTY_SCENARIO, runForecast } from "../analytics/forecast";
import type { AccountBalance } from "../analytics/types";
import type { CategoryDTO, TransactionDTO } from "../services/queries";
import { AI_MODEL, describeAiFailure, getGemini } from "./client";

export interface CopilotData {
  transactions: TransactionDTO[];
  accounts: AccountBalance[];
  categories: CategoryDTO[];
  baseCurrency: string;
}

export type CopilotEvent =
  { type: "text"; text: string } | { type: "tool"; name: string; label: string } | { type: "error"; message: string } | { type: "done" };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_TOOL_ROUNDS = 8;

const QueryInput = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  categories: z.array(z.string()).optional(),
  kinds: z.array(z.enum(["EXPENSE", "INCOME", "TRANSFER"])).optional(),
  banks: z.array(z.enum(["REVOLUT", "CREDIT_AGRICOLE"])).optional(),
  merchant_search: z.string().optional(),
  direction: z.enum(["in", "out", "any"]).optional(),
  group_by: z.enum(["none", "category", "merchant", "month", "bank"]).optional(),
  limit: z.number().int().optional(),
});

const ForecastInput = z.object({
  horizon_months: z.number().int(),
  income_change_pct: z.number().optional(),
  expense_change_pct: z.number().optional(),
  cancel_merchants: z.array(z.string()).optional(),
  one_off_amount: z.number().optional(),
  one_off_month: z.number().int().optional(),
});

const TOOLS: FunctionDeclaration[] = [
  {
    name: "query_transactions",
    description:
      "Filter and aggregate the user's categorized transactions across all banks. Returns totals (money in, money out, net, count), optional groups, and the largest matching transactions. Amounts are in the user's currency; outflows are negative in samples. Use this for any question about how much was spent/earned, where, when, or at which bank.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Inclusive ISO date YYYY-MM-DD" },
        end_date: { type: "string", description: "Inclusive ISO date YYYY-MM-DD" },
        categories: { type: "array", items: { type: "string" }, description: "Exact category names (see the category list in the system prompt)" },
        kinds: {
          type: "array",
          items: { type: "string", enum: ["EXPENSE", "INCOME", "TRANSFER"] },
          description: "Category kinds. Spending questions should use EXPENSE; transfers are moves between own accounts/savings.",
        },
        banks: { type: "array", items: { type: "string", enum: ["REVOLUT", "CREDIT_AGRICOLE"] } },
        merchant_search: { type: "string", description: "Case/accent-insensitive substring matched against merchant and raw description" },
        direction: { type: "string", enum: ["in", "out", "any"] },
        group_by: { type: "string", enum: ["none", "category", "merchant", "month", "bank"] },
        limit: { type: "integer", description: "Max sample transactions / groups to return (default 15, max 50)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_financial_overview",
    description:
      "Net worth by account, KPIs (cash flow, savings rate, burn rate, runway) for the latest month, and monthly income/expense totals for the last 12 months.",
    parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_subscriptions_and_savings",
    description:
      "Detected recurring charges (subscriptions, rent, bills) and recurring income, merchant concentration, and ranked savings opportunities with estimated yearly savings.",
    parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "run_forecast",
    description:
      "Project the balance forward from recurring and typical variable flows, optionally with a what-if scenario. Returns monthly projected balance with an ~80% range.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        horizon_months: { type: "integer", description: "3, 6 or 12" },
        income_change_pct: { type: "number", description: "e.g. 10 for +10% income" },
        expense_change_pct: { type: "number", description: "e.g. -15 for 15% less variable spending" },
        cancel_merchants: { type: "array", items: { type: "string" }, description: "Merchant names of recurring charges to cancel" },
        one_off_amount: { type: "number", description: "One-off cash event in currency units, negative for a purchase" },
        one_off_month: { type: "integer", description: "Months from now for the one-off (1 = next month)" },
      },
      required: ["horizon_months"],
      additionalProperties: false,
    },
  },
];

const TOOL_LABELS: Record<string, string> = {
  query_transactions: "Querying transactions",
  get_financial_overview: "Reading your overview",
  get_subscriptions_and_savings: "Scanning subscriptions",
  run_forecast: "Running forecast",
};

const SYSTEM_PROMPT = `You are FinanceVault Copilot, a private financial analyst embedded in the user's personal finance dashboard. You answer questions about the user's own money using their categorized bank data from Revolut and Crédit Agricole.

How to work:
- Always ground numbers in tool results. Never estimate a figure you could query. If the data doesn't cover the requested period, say so and state the range you do have.
- Spending means EXPENSE categories; transfers between the user's own accounts and into savings are not spending. Refunds booked in an expense category reduce that category's spend (the tools already net them).
- "This month" / "last month" refer to the calendar relative to today's date given below. If the current month has little or no data yet, say so and offer the latest complete month.
- Answer first, in one or two sentences with the key number, then supporting detail. Use short bullet lists or a compact markdown table for breakdowns. Format money like €1,234.56.
- Be candid and practical; when relevant, suggest one concrete action. You are not a licensed advisor: for investment, tax or legal decisions, give general information and suggest confirming with a professional.`;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function executeTool(name: string, input: unknown, data: CopilotData): unknown {
  const base = data.transactions.filter((t) => t.currency === data.baseCurrency);
  const money = (cents: number) => formatMoney(cents, data.baseCurrency);
  switch (name) {
    case "query_transactions": {
      const q = QueryInput.parse(input);
      const limit = Math.min(50, Math.max(1, q.limit ?? 15));
      const cats = q.categories?.map((c) => foldText(c));
      const search = q.merchant_search ? foldText(q.merchant_search) : null;
      const rows = base.filter(
        (t) =>
          (!q.start_date || t.date >= q.start_date) &&
          (!q.end_date || t.date <= q.end_date) &&
          (!cats || cats.includes(foldText(t.categoryName))) &&
          (!q.kinds || q.kinds.includes(t.kind)) &&
          (!q.banks || q.banks.includes(t.institution as "REVOLUT")) &&
          (!search || foldText(t.merchantName).includes(search) || foldText(t.rawDescription).includes(search)) &&
          (!q.direction || q.direction === "any" || (q.direction === "in" ? t.amountCents > 0 : t.amountCents < 0)),
      );
      const inflow = rows.filter((t) => t.amountCents > 0).reduce((a, t) => a + t.amountCents, 0);
      const outflow = rows.filter((t) => t.amountCents < 0).reduce((a, t) => a - t.amountCents, 0);
      let groups: unknown = undefined;
      if (q.group_by && q.group_by !== "none") {
        const keyOf = (t: TransactionDTO) =>
          q.group_by === "category" ? t.categoryName : q.group_by === "merchant" ? t.merchantName : q.group_by === "month" ? t.date.slice(0, 7) : t.institution;
        const map = new Map<string, { net: number; count: number }>();
        for (const t of rows) {
          const g = map.get(keyOf(t)) ?? { net: 0, count: 0 };
          g.net += t.amountCents;
          g.count++;
          map.set(keyOf(t), g);
        }
        groups = [...map.entries()]
          .sort((a, b) => (q.group_by === "month" ? a[0].localeCompare(b[0]) : Math.abs(b[1].net) - Math.abs(a[1].net)))
          .slice(0, q.group_by === "month" ? 60 : limit)
          .map(([key, g]) => ({ key, net: money(g.net), count: g.count }));
      }
      const largest = [...rows]
        .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents))
        .slice(0, limit)
        .map((t) => ({ date: t.date, merchant: t.merchantName, amount: money(t.amountCents), category: t.categoryName, bank: t.institution }));
      const dates = rows.map((t) => t.date).sort();
      return {
        match_count: rows.length,
        money_in: money(inflow),
        money_out: money(outflow),
        net: money(inflow - outflow),
        first_date: dates[0] ?? null,
        last_date: dates.at(-1) ?? null,
        groups,
        largest_transactions: largest,
      };
    }
    case "get_financial_overview": {
      const k = computeKpis(base, data.accounts, data.baseCurrency);
      return {
        accounts: data.accounts.map((a) => ({
          name: a.name,
          currency: a.currency,
          balance: formatMoney(a.balanceCents, a.currency),
          from_statement: a.reported,
        })),
        net_worth: money(k.netWorthCents),
        latest_month: k.focusMonth,
        cash_flow_latest_month: money(k.cashFlowCents),
        cash_flow_previous_month: money(k.cashFlowPrevCents),
        savings_rate_3m: `${round2(k.savingsRate * 100)}%`,
        burn_rate_3m_avg: money(k.burnRateCents),
        runway_months: Number.isFinite(k.runwayMonths) ? round2(k.runwayMonths) : null,
        monthly: monthlySeries(base)
          .slice(-12)
          .map((p) => ({ month: p.month, income: money(p.incomeCents), expenses: money(p.expenseCents), net: money(p.netCents) })),
      };
    }
    case "get_subscriptions_and_savings": {
      const subs = detectRecurring(base);
      const income = detectRecurring(base, { direction: "CREDIT" });
      const conc = merchantConcentration(base.filter((t) => t.date >= monthsAgo(base, 3)));
      const k = computeKpis(base, data.accounts, data.baseCurrency);
      return {
        recurring_charges: subs.map((s) => ({
          merchant: s.merchantName,
          category: s.categoryName,
          cadence: s.cadence,
          amount: money(s.amountCents),
          yearly_cost: money(s.annualCents),
          active: s.active,
          last: s.lastDate,
          next_expected: s.nextDate,
        })),
        recurring_income: income.map((s) => ({ source: s.merchantName, cadence: s.cadence, amount: money(s.amountCents) })),
        top_merchants_last_3_months: conc.merchants
          .slice(0, 8)
          .map((m) => ({ merchant: m.merchantName, spent: money(m.totalCents), share: `${round2(m.share * 100)}%` })),
        concentration_level: conc.level,
        savings_opportunities: findOpportunities({
          txs: base,
          subscriptions: subs,
          concentration: conc,
          focusMonth: k.focusMonth,
          currency: data.baseCurrency,
        }).map((o) => ({
          title: o.title,
          detail: o.detail,
          est_yearly_savings: money(o.annualSavingsCents),
        })),
      };
    }
    case "run_forecast": {
      const f = ForecastInput.parse(input);
      const subs = detectRecurring(base);
      const income = detectRecurring(base, { direction: "CREDIT" });
      const netWorth = data.accounts.filter((a) => a.currency === data.baseCurrency).reduce((a, x) => a + x.balanceCents, 0);
      const baseline = buildBaseline({ txs: base, recurringExpenses: subs, recurringIncome: income, startBalanceCents: netWorth });
      const cancel = (f.cancel_merchants ?? []).map(foldText);
      const scenario = {
        ...EMPTY_SCENARIO,
        incomeChange: (f.income_change_pct ?? 0) / 100,
        expenseChange: (f.expense_change_pct ?? 0) / 100,
        cancelled: baseline.recurringExpenses.filter((r) => cancel.some((c) => foldText(r.name).includes(c) || r.key.includes(c))).map((r) => r.key),
        oneOffs: f.one_off_amount ? [{ id: "x", label: "one-off", monthOffset: f.one_off_month ?? 1, amountCents: Math.round(f.one_off_amount * 100) }] : [],
      };
      const horizon = Math.min(24, Math.max(1, f.horizon_months));
      const points = runForecast(baseline, horizon, scenario);
      return {
        starting_balance: money(netWorth),
        assumptions: {
          recurring_income_monthly: money(baseline.recurringIncome.reduce((a, r) => a + r.monthlyCents, 0)),
          recurring_expenses_monthly: money(baseline.recurringExpenses.reduce((a, r) => a + r.monthlyCents, 0)),
          typical_variable_spend_monthly: money(baseline.variableExpenses.reduce((a, v) => a + v.monthlyCents, 0)),
          cancelled: scenario.cancelled,
          inflation: "2%/yr",
          history_months_used: baseline.historyMonths,
        },
        projection: points.map((p) => ({
          month: p.month,
          net: money(p.netCents),
          balance: money(p.balanceCents),
          range: `${money(p.lowCents)} – ${money(p.highCents)}`,
        })),
      };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function monthsAgo(txs: TransactionDTO[], n: number): string {
  const last = txs
    .map((t) => t.date)
    .sort()
    .at(-1);
  if (!last) return "0000-00-00";
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function dataContext(data: CopilotData): string {
  const dates = data.transactions.map((t) => t.date).sort();
  const banks = [...new Set(data.accounts.map((a) => a.institution))].join(", ") || "none yet";
  return [
    `Today's date: ${new Date().toISOString().slice(0, 10)}`,
    `Base currency: ${data.baseCurrency}`,
    `Data coverage: ${dates[0] ?? "no data"} to ${dates.at(-1) ?? "no data"} (${data.transactions.length} transactions)`,
    `Banks: ${banks}`,
    `Accounts: ${data.accounts.map((a) => a.name).join("; ") || "none"}`,
    `Categories: ${data.categories.map((c) => `${c.name} [${c.kind}]`).join(", ")}`,
  ].join("\n");
}

/**
 * Manual agentic loop with streaming. Each round streams text to the client; function calls are
 * executed locally against the user's data and fed back until the model answers in plain text.
 * The model's turn is appended unchanged (including thought signatures), as Gemini requires.
 */
export async function* runCopilot(history: ChatTurn[], data: CopilotData, signal?: AbortSignal): AsyncGenerator<CopilotEvent> {
  const ai = getGemini();
  const contents: Content[] = history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await ai.models.generateContentStream({
      model: AI_MODEL,
      contents,
      config: {
        systemInstruction: `${SYSTEM_PROMPT}\n\n${dataContext(data)}`,
        tools: [{ functionDeclarations: TOOLS }],
        abortSignal: signal,
      },
    });

    const parts: Part[] = [];
    const calls: FunctionCall[] = [];
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      finishReason = candidate?.finishReason ?? finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        parts.push(part);
        if (part.functionCall) calls.push(part.functionCall);
        else if (part.text && !part.thought) yield { type: "text", text: part.text };
      }
    }

    if (finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST") {
      yield { type: "error", message: "The assistant declined to answer that request." };
      break;
    }
    if (!calls.length) {
      if (finishReason === "MAX_TOKENS") yield { type: "text", text: "\n\n_(Response truncated.)_" };
      break;
    }

    contents.push({ role: "model", parts });
    const responses: Part[] = [];
    for (const call of calls) {
      const name = call.name ?? "";
      yield { type: "tool", name, label: TOOL_LABELS[name] ?? name };
      let response: Record<string, unknown>;
      try {
        response = { output: executeTool(name, call.args ?? {}, data) };
      } catch (err) {
        response = {
          error: err instanceof z.ZodError ? `INVALID_INPUT: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : (err as Error).message,
        };
      }
      responses.push({ functionResponse: { id: call.id, name, response } });
    }
    contents.push({ role: "user", parts: responses });
    if (round === MAX_TOOL_ROUNDS - 1) yield { type: "text", text: "\n\n_(Stopped after too many lookups. Try a more specific question.)_" };
  }
  yield { type: "done" };
}

export function describeCopilotError(err: unknown): string {
  const reason = describeAiFailure(err);
  return `The Copilot couldn't answer: ${reason}.`;
}
