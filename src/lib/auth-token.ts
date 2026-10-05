import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stateless session tokens shared by proxy.ts and server code (no Next.js imports here).
 * Format: v1.<expiresAtMs>.<hmac>. The signing key is derived from AUTH_SECRET *and* the
 * password, so changing either one signs everybody out.
 */
export const SESSION_COOKIE = "fv_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthConfig = { mode: "open" } | { mode: "password"; password: string; secret: string } | { mode: "misconfigured"; reason: string };

export function authConfig(): AuthConfig {
  const password = process.env.FINANCEVAULT_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  const production = process.env.NODE_ENV === "production";
  if (!password) {
    // Local development stays frictionless; a deployed instance must never be open.
    return production ? { mode: "misconfigured", reason: "FINANCEVAULT_PASSWORD is not set." } : { mode: "open" };
  }
  if (!secret || secret.length < 32) {
    if (production) return { mode: "misconfigured", reason: "AUTH_SECRET must be set to a random string of at least 32 characters." };
    return { mode: "password", password, secret: `dev-only-secret:${password}` };
  }
  return { mode: "password", password, secret };
}

function signingKey(cfg: { password: string; secret: string }) {
  return createHash("sha256").update(`${cfg.secret}\0${cfg.password}`).digest();
}

function sign(payload: string, key: Buffer) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function createSessionToken(cfg: { password: string; secret: string }, now = Date.now()): string {
  const payload = `v1.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload, signingKey(cfg))}`;
}

export function verifySessionToken(token: string | undefined, cfg: { password: string; secret: string }, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < now) return false;
  const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`, signingKey(cfg)));
  const actual = Buffer.from(parts[2]);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time password comparison (hashing first equalizes lengths). */
export function passwordMatches(candidate: string, password: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(password).digest();
  return timingSafeEqual(a, b);
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return "/";
  return next;
}
