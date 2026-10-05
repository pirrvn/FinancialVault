import { Vault } from "lucide-react";
import { redirect } from "next/navigation";
import { authConfig } from "@/lib/auth-token";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const cfg = authConfig();
  const { next } = await searchParams;
  if (cfg.mode === "open") redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm animate-rise text-center">
        <span className="mx-auto mb-6 flex size-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#1d1d1f] to-[#48484a] text-white shadow-lg dark:from-[#f5f5f7] dark:to-[#c7c7cc] dark:text-black">
          <Vault className="size-6" strokeWidth={2.2} />
        </span>
        <h1 className="text-[28px] font-semibold tracking-tight">FinanceVault</h1>
        <p className="mt-1 text-[15px] text-muted">Enter your password to continue.</p>
        {cfg.mode === "misconfigured" ? (
          <p className="mt-8 rounded-2xl bg-surface p-4 text-left text-[13px] text-negative shadow-card">
            This deployment isn&apos;t secured yet: {cfg.reason} Add it in your hosting provider&apos;s environment variables and redeploy.
          </p>
        ) : (
          <LoginForm next={next ?? ""} />
        )}
      </div>
    </main>
  );
}
