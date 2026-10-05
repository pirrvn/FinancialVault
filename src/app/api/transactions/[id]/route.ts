import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/services/user";
import { NotFoundError, overrideCategory } from "@/lib/services/learning";

export const runtime = "nodejs";

const Patch = z.object({ categoryId: z.string().min(1), applyToSimilar: z.boolean().optional(), learn: z.boolean().optional() });

/** PATCH /api/transactions/:id — manual override (+ learning). Same semantics as overrideCategoryAction. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const user = await getCurrentUser();
  try {
    const result = await overrideCategory(user.id, id, parsed.data.categoryId, parsed.data);
    for (const p of ["/", "/transactions", "/insights", "/forecast", "/rules"]) revalidatePath(p);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
