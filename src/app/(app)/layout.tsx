import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/services/user";
import { authConfig } from "@/lib/auth-token";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  const reviewCount = await prisma.transaction.count({ where: { userId: user.id, needsReview: true } });
  return (
    <AppShell reviewCount={reviewCount} canSignOut={authConfig().mode === "password"}>
      {children}
    </AppShell>
  );
}
