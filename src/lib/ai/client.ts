import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = process.env.FINANCEVAULT_AI_MODEL || "claude-opus-5-5";

/**
 * Refusal fallbacks: if a safety classifier declines a request, the API re-runs it on
 * Anthropic's recommended fallback model server-side instead of returning a refusal.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

let client: Anthropic | null = null;

/** Credentials resolve from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile. */
export function getAnthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Cheap pre-check so we don't attempt calls that can only fail. */
export function aiConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || process.env.FINANCEVAULT_AI_ENABLED === "true",
  );
}

/** Missing credentials fail inside the SDK before any request is sent, as a plain Error. */
export function isMissingCredentials(err: unknown): boolean {
  return err instanceof Error && /could not resolve authentication method/i.test(err.message);
}
