import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/services/user";
import { importStatement, type ImportSummary } from "@/lib/services/import";
import { StatementParseError, type InstitutionId } from "@/lib/parsers";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Vercel caps request bodies at 4.5 MB; the client sends one file per request. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Multipart upload of one or more statements. Field "files" (repeatable), optional "institution". */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const hint = form.get("institution");
  const institution = hint === "REVOLUT" || hint === "CREDIT_AGRICOLE" ? (hint as InstitutionId) : null;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

  const results: ({ ok: true; summary: ImportSummary } | { ok: false; fileName: string; error: string })[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      results.push({ ok: false, fileName: file.name, error: "File is larger than 4 MB. Export a shorter period." });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      results.push({ ok: true, summary: await importStatement(user.id, file.name, bytes, institution) });
    } catch (err) {
      const message = err instanceof StatementParseError ? err.message : "Unexpected error while importing this file.";
      if (!(err instanceof StatementParseError)) console.error("[upload]", err);
      results.push({ ok: false, fileName: file.name, error: message });
    }
  }
  for (const p of ["/", "/transactions", "/insights", "/forecast", "/import"]) revalidatePath(p);
  return NextResponse.json({ results });
}
