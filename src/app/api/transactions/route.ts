import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/services/user";
import { getTransactions } from "@/lib/services/queries";

export const runtime = "nodejs";

/** GET /api/transactions?since=YYYY-MM-DD&needsReview=1 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  const url = new URL(req.url);
  const since = url.searchParams.get("since");
  let rows = await getTransactions(user.id, since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? { since: new Date(since + "T00:00:00Z") } : {});
  if (url.searchParams.get("needsReview") === "1") rows = rows.filter((r) => r.needsReview);
  return NextResponse.json({ transactions: rows });
}
