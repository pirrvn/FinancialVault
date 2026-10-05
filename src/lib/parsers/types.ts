export type InstitutionId = "REVOLUT" | "CREDIT_AGRICOLE";

export interface ParsedTransaction {
  date: Date;
  valueDate?: Date | null;
  amountCents: number;
  currency: string;
  rawDescription: string;
  bankType?: string | null;
  /** Running balance after this row when the statement provides one. */
  balanceAfterCents?: number | null;
  /** Routes the row to an account (e.g. Revolut "Current:EUR"). */
  accountRef: string;
  accountLabel: string;
}

export interface ParseResult {
  institution: InstitutionId;
  transactions: ParsedTransaction[];
  /** Closing balances per account ref, when the statement exposes one. */
  balances: Record<string, { cents: number; asOf: Date }>;
  skipped: number;
  warnings: string[];
}

export class StatementParseError extends Error {}
