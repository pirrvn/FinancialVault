import type { Kind } from "../categorization/defaults";

/** Serializable transaction shape shared by server analytics and client components. */
export interface AnalyticsTx {
  id: string;
  /** ISO day, YYYY-MM-DD */
  date: string;
  amountCents: number;
  currency: string;
  merchantKey: string;
  merchantName: string;
  categoryId: string;
  categoryName: string;
  kind: Kind;
  accountId: string;
}

export interface AccountBalance {
  id: string;
  name: string;
  institution: string;
  currency: string;
  balanceCents: number;
  /** True when anchored on a statement balance, false when reconstructed from transactions only. */
  reported: boolean;
}
