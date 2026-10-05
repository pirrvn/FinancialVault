"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, createSessionToken, passwordMatches, safeNextPath, SESSION_COOKIE, SESSION_TTL_MS } from "./auth-token";

export async function loginAction(_prev: { error: string } | null, form: FormData): Promise<{ error: string }> {
  const cfg = authConfig();
  if (cfg.mode === "misconfigured") return { error: `Server setup incomplete: ${cfg.reason}` };
  const next = safeNextPath(form.get("next")?.toString());
  if (cfg.mode === "open") redirect(next);
  const candidate = form.get("password")?.toString() ?? "";
  if (!passwordMatches(candidate, cfg.password)) {
    // Slow down guessing; serverless instances make an in-memory rate limiter unreliable.
    await new Promise((r) => setTimeout(r, 1200));
    return { error: "Incorrect password." };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(cfg), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  redirect(next);
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
