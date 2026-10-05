import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authConfig, SESSION_COOKIE, verifySessionToken } from "./auth-token";

/** Throws a redirect to /login unless the request carries a valid session (or auth is off locally). */
export async function requireSession() {
  const cfg = authConfig();
  if (cfg.mode === "open") return;
  if (cfg.mode === "password" && verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, cfg)) return;
  redirect("/login");
}
