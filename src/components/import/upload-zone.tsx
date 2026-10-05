"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, LoaderCircle, Sparkles, Wand2, CircleAlert } from "lucide-react";
import { Segmented } from "../ui/segmented";
import { cn } from "@/lib/utils";

type Hint = "AUTO" | "REVOLUT" | "CREDIT_AGRICOLE";

interface Summary {
  fileName: string;
  institution: string;
  accounts: string[];
  rowsParsed: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsSkipped: number;
  byRule: number;
  byAi: number;
  byFallback: number;
  needsReview: number;
  warnings: string[];
}
type Result = { ok: true; summary: Summary } | { ok: false; fileName: string; error: string };

export function UploadZone() {
  const router = useRouter();
  const [hint, setHint] = React.useState<Hint>("AUTO");
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState<string[] | null>(null);
  const [results, setResults] = React.useState<Result[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const depth = React.useRef(0);

  const upload = async (files: File[]) => {
    const accepted = files.filter((f) => /\.(csv|txt|tsv)$/i.test(f.name) || f.type.includes("csv") || f.type === "text/plain");
    if (!accepted.length) {
      setResults([{ ok: false, fileName: files[0]?.name ?? "file", error: "Only CSV exports are supported. In your bank app, export the statement as CSV." }]);
      return;
    }
    setBusy(accepted.map((f) => f.name));
    setResults([]);
    // One request per file: hosts like Vercel cap request bodies at 4.5 MB, and results stream in as each file finishes.
    try {
      for (const file of accepted) {
        const form = new FormData();
        form.append("files", file);
        if (hint !== "AUTO") form.append("institution", hint);
        let result: Result;
        try {
          const res = await fetch("/api/upload", { method: "POST", body: form });
          const json = await res.json().catch(() => null);
          result = json?.results?.[0] ?? { ok: false, fileName: file.name, error: json?.error ?? `Upload failed (${res.status})` };
        } catch {
          result = { ok: false, fileName: file.name, error: "Network error. Check your connection and try again." };
        }
        setResults((prev) => [...prev, result]);
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop statements here or press Enter to browse"
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onClick={() => !busy && inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (!busy) void upload([...e.dataTransfer.files]);
        }}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-[1.5px] border-dashed px-6 py-16 text-center transition-all duration-300 ease-[var(--ease-apple)]",
          dragging ? "scale-[1.01] border-accent bg-[color-mix(in_srgb,var(--accent)_7%,var(--surface))]" : "border-fill-strong bg-surface hover:border-subtle",
          busy && "pointer-events-none",
        )}
      >
        <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv" multiple hidden onChange={(e) => e.target.files && upload([...e.target.files])} />
        <span
          className={cn(
            "mb-5 flex size-16 items-center justify-center rounded-[20px] transition-all duration-300",
            dragging ? "-translate-y-1 bg-accent text-accent-fg shadow-lg" : "bg-fill text-accent",
          )}
        >
          {busy ? <LoaderCircle className="size-7 animate-spin" /> : <UploadCloud className="size-7" />}
        </span>
        {busy ? (
          <>
            <p className="text-[17px] font-semibold tracking-tight">
              Importing {busy.length} file{busy.length > 1 ? "s" : ""}…
            </p>
            <p className="mt-1 text-sm text-muted">Parsing, removing duplicates, and categorizing with rules and AI.</p>
          </>
        ) : (
          <>
            <p className="text-[17px] font-semibold tracking-tight">{dragging ? "Release to import" : "Drop statements here"}</p>
            <p className="mt-1 text-sm text-muted">
              or <span className="font-medium text-accent">browse</span> · Revolut CSV · Crédit Agricole CSV (DD/MM/YYYY, “;” separated)
            </p>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <span className="text-[13px] text-muted">Format</span>
        <Segmented
          size="sm"
          value={hint}
          onChange={setHint}
          options={[
            { value: "AUTO", label: "Auto-detect" },
            { value: "REVOLUT", label: "Revolut" },
            { value: "CREDIT_AGRICOLE", label: "Crédit Agricole" },
          ]}
        />
      </div>

      {results.map((r, i) =>
        r.ok ? (
          <SummaryCard key={i} s={r.summary} />
        ) : (
          <div key={i} className="flex animate-rise items-start gap-3 rounded-2xl bg-surface p-4 shadow-card">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-negative" />
            <div>
              <p className="text-[14px] font-medium">{r.fileName}</p>
              <p className="text-[13px] text-muted">{r.error}</p>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function SummaryCard({ s }: { s: Summary }) {
  const stats = [
    { label: "Imported", value: s.rowsImported },
    { label: "Duplicates skipped", value: s.rowsDuplicate },
    { label: "Ignored rows", value: s.rowsSkipped },
  ];
  const tiers = [
    { icon: Wand2, label: "Rules", value: s.byRule },
    { icon: Sparkles, label: "AI", value: s.byAi },
    { icon: CircleAlert, label: "Default", value: s.byFallback },
  ];
  return (
    <div className="animate-rise rounded-3xl bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-positive" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <FileText className="size-4 text-subtle" /> {s.fileName}
          </p>
          <p className="text-[13px] text-muted">{s.accounts.join(" · ")}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((x) => (
          <div key={x.label} className="rounded-2xl bg-fill px-3 py-2.5">
            <p className="tabular text-[20px] font-semibold">{x.value}</p>
            <p className="text-[12px] text-muted">{x.label}</p>
          </div>
        ))}
      </div>
      {s.rowsImported > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
          <span className="text-muted">Categorized by</span>
          {tiers.map((t) => (
            <span key={t.label} className="inline-flex items-center gap-1">
              <t.icon className="size-3.5 text-subtle" /> <span className="tabular font-medium">{t.value}</span> {t.label.toLowerCase()}
            </span>
          ))}
          {s.needsReview > 0 && (
            <a href="/transactions?review=1" className="ml-auto font-medium text-accent">
              Review {s.needsReview} →
            </a>
          )}
        </div>
      )}
      {s.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12.5px] text-warning">
          {s.warnings.map((w) => (
            <li key={w}>• {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
