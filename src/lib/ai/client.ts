import { ApiError, GoogleGenAI } from "@google/genai";

/** Gemini Flash: fast and inexpensive; override with FINANCEVAULT_AI_MODEL. */
export const AI_MODEL = process.env.FINANCEVAULT_AI_MODEL || "gemini-3.8-flash";

let client: GoogleGenAI | null = null;

function apiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export function getGemini(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: apiKey() });
  return client;
}

/** AI features are optional: without a key FinanceVault runs on rules + review flags. */
export function aiConfigured(): boolean {
  return Boolean(apiKey());
}

/** Turn SDK/API failures into a short, user-facing reason. */
export function describeAiFailure(err: unknown): string {
  if (!aiConfigured()) return "no Gemini API key is configured (set GEMINI_API_KEY)";
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) return "the Gemini API key is invalid";
    if (err.status === 401 || err.status === 403) return "the Gemini API key was rejected";
    if (err.status === 429) return "the Gemini quota is exhausted for now (free tier limits); try again later";
    if (err.status >= 500) return "Gemini is temporarily unavailable";
    return `Gemini returned an error (${err.status})`;
  }
  return "an unexpected error occurred";
}
