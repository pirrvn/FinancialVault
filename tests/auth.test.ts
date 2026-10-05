import { afterEach, describe, expect, it, vi } from "vitest";
import { authConfig, createSessionToken, passwordMatches, safeNextPath, SESSION_TTL_MS, verifySessionToken } from "@/lib/auth-token";

const cfg = { password: "correct horse battery", secret: "s".repeat(40) };

describe("session tokens", () => {
  it("round-trips and expires", () => {
    const now = 1_700_000_000_000;
    const token = createSessionToken(cfg, now);
    expect(verifySessionToken(token, cfg, now + 1000)).toBe(true);
    expect(verifySessionToken(token, cfg, now + SESSION_TTL_MS + 1)).toBe(false);
  });

  it("rejects tampering, other secrets and a changed password", () => {
    const token = createSessionToken(cfg);
    const [v, exp, sig] = token.split(".");
    expect(verifySessionToken(`${v}.${Number(exp) + 1}.${sig}`, cfg)).toBe(false);
    expect(verifySessionToken(token, { ...cfg, secret: "t".repeat(40) })).toBe(false);
    expect(verifySessionToken(token, { ...cfg, password: "new password" })).toBe(false);
    expect(verifySessionToken("garbage", cfg)).toBe(false);
    expect(verifySessionToken(undefined, cfg)).toBe(false);
  });

  it("compares passwords exactly", () => {
    expect(passwordMatches("correct horse battery", cfg.password)).toBe(true);
    expect(passwordMatches("correct horse batter", cfg.password)).toBe(false);
  });

  it("only redirects to same-site paths", () => {
    expect(safeNextPath("/transactions?review=1")).toBe("/transactions?review=1");
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "/login", "", null]) expect(safeNextPath(bad)).toBe("/");
  });
});

describe("auth config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is open in development without a password", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FINANCEVAULT_PASSWORD", "");
    expect(authConfig().mode).toBe("open");
  });

  it("never runs open in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FINANCEVAULT_PASSWORD", "");
    expect(authConfig().mode).toBe("misconfigured");
    vi.stubEnv("FINANCEVAULT_PASSWORD", "pw");
    vi.stubEnv("AUTH_SECRET", "short");
    expect(authConfig().mode).toBe("misconfigured");
    vi.stubEnv("AUTH_SECRET", "x".repeat(32));
    expect(authConfig().mode).toBe("password");
  });
});
