import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/services/user";

export const runtime = "nodejs";

/** GET /api/rules — all rules with their category, highest priority first. Mutations go through server actions. */
export async function GET() {
  const user = await getCurrentUser();
  const rules = await prisma.categorizationRule.findMany({
    where: { userId: user.id },
    include: { category: { select: { name: true } } },
    orderBy: [{ priority: "desc" }, { hitCount: "desc" }],
  });
  return NextResponse.json({ rules });
}
