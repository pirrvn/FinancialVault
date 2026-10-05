import Link from "next/link";
import { UploadCloud } from "lucide-react";

export function EmptyState({
  title = "Bring your statements",
  body = "Import a Revolut or Crédit Agricole CSV export to see your net worth, cash flow and spending, categorized automatically.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="mx-auto flex max-w-lg animate-rise flex-col items-center rounded-3xl bg-surface px-8 py-14 text-center shadow-card">
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-fill">
        <UploadCloud className="size-6 text-accent" />
      </span>
      <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
      <Link
        href="/import"
        className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-fg transition hover:brightness-110"
      >
        Import statements
      </Link>
    </div>
  );
}
