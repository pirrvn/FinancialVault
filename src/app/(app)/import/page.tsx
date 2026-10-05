import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/services/user";
import { aiConfigured } from "@/lib/ai/client";
import { PageHeader } from "@/components/app-shell";
import { UploadZone } from "@/components/import/upload-zone";
import { Card, CardHeader } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  const user = await getCurrentUser();
  const batches = await prisma.importBatch.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const ai = aiConfigured();
  return (
    <>
      <PageHeader title="Import" subtitle="Add monthly statements. Overlapping or repeated files are de-duplicated automatically." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <UploadZone />
        <div className="space-y-4">
          <Card className="p-5">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <Sparkles className="size-4 text-accent" /> Categorization pipeline
            </p>
            <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-muted">
              <li>
                <span className="font-medium text-fg">1 · Rules.</span> Your corrections first, then your rules, past AI decisions and a built-in French
                merchant lexicon.
              </li>
              <li>
                <span className="font-medium text-fg">2 · AI.</span>{" "}
                {ai
                  ? "Unknown merchants are sent to Gemini, one request per batch of merchants. Confident answers are saved as rules."
                  : "Off (optional). Unknown merchants simply wait in Review."}
              </li>
              <li>
                <span className="font-medium text-fg">3 · You.</span> New merchants wait in Review with suggestions from your own history. Sort each one once
                and FinanceVault remembers it.
              </li>
            </ol>
          </Card>
          <Card className="p-5">
            <p className="text-[14px] font-semibold">Exporting your statements</p>
            <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">
              <li>
                <span className="font-medium text-fg">Revolut:</span> Account → Statement → Excel/CSV → pick the month.
              </li>
              <li>
                <span className="font-medium text-fg">Crédit Agricole:</span> Mes documents → e-relevés → download the PDF statement (or export operations as
                CSV if available).
              </li>
            </ul>
          </Card>
        </div>
      </div>
      {batches.length > 0 && (
        <Card className="mt-8">
          <CardHeader title="History" subtitle="Most recent imports" />
          <ul className="mt-3 divide-y divide-line px-6 pb-3">
            {batches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium">{b.fileName}</span>
                <span className="text-muted">{b.institution === "REVOLUT" ? "Revolut" : "Crédit Agricole"}</span>
                <span className="tabular text-muted">
                  {b.rowsImported} new · {b.rowsDuplicate} dup.
                </span>
                <span className={b.status === "FAILED" ? "text-negative" : "text-subtle"}>
                  {b.status === "FAILED"
                    ? "Failed"
                    : b.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
