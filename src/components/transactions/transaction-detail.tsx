"use client";

import * as React from "react";
import { Sparkles, Wand2, Pencil, CircleAlert } from "lucide-react";
import type { CategoryDTO, TransactionDTO } from "@/lib/services/queries";
import { formatMoney } from "@/lib/money";
import { updateNoteAction } from "@/lib/actions";
import { Sheet } from "../ui/sheet";
import { Button } from "../ui/button";
import { CategoryIcon } from "../category-icon";
import { useToast } from "../ui/toast";

const SOURCE_COPY = {
  RULE: { icon: Wand2, label: "Matched a rule" },
  AI: { icon: Sparkles, label: "Categorized by AI" },
  MANUAL: { icon: Pencil, label: "Set by you" },
  FALLBACK: { icon: CircleAlert, label: "Default category, needs your input" },
} as const;

export function TransactionDetail({
  tx,
  category,
  onOpenChange,
  onRecategorize,
  onConfirm,
}: {
  tx: TransactionDTO | null;
  category?: CategoryDTO;
  onOpenChange: (o: boolean) => void;
  onRecategorize: () => void;
  onConfirm: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = React.useState("");
  React.useEffect(() => setNote(tx?.note ?? ""), [tx]);
  if (!tx)
    return (
      <Sheet open={false} onOpenChange={onOpenChange} title="">
        {null}
      </Sheet>
    );
  const src = SOURCE_COPY[tx.categorySource];
  const rows: [string, React.ReactNode][] = [
    [
      "Date",
      new Date(tx.date + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
    ],
    ["Account", tx.accountName],
    [
      "Bank description",
      <span key="d" className="font-mono text-[12px] break-words">
        {tx.rawDescription}
      </span>,
    ],
    [
      "Merchant key",
      <span key="k" className="font-mono text-[12px]">
        {tx.merchantKey}
      </span>,
    ],
  ];
  return (
    <Sheet open={!!tx} onOpenChange={onOpenChange} title={tx.merchantName} description={tx.accountName}>
      <div className="flex-1 scrollbar-thin space-y-5 overflow-y-auto px-6 pb-6">
        <p className={`tabular text-[34px] font-semibold tracking-tight ${tx.amountCents > 0 ? "text-positive" : ""}`}>
          {formatMoney(tx.amountCents, tx.currency, { sign: tx.amountCents > 0 })}
        </p>
        <div className="flex items-center gap-3 rounded-2xl bg-fill p-3">
          {category && <CategoryIcon icon={category.icon} color={category.color} size="lg" />}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium">{tx.categoryName}</p>
            <p className="flex items-center gap-1 text-[12px] text-muted">
              <src.icon className="size-3" /> {src.label}
              {tx.confidence !== null && tx.categorySource === "AI" && ` · ${Math.round(tx.confidence * 100)}% confident`}
            </p>
          </div>
          <Button size="sm" onClick={onRecategorize}>
            Change
          </Button>
        </div>
        {tx.needsReview && (
          <Button variant="primary" className="w-full justify-center" onClick={onConfirm}>
            Category is correct
          </Button>
        )}
        <dl className="divide-y divide-line text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-4 py-2.5">
              <dt className="w-32 shrink-0 text-muted">{k}</dt>
              <dd className="min-w-0 flex-1">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted" htmlFor="note">
            Note
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={async () => {
              if (note === (tx.note ?? "")) return;
              const res = await updateNoteAction(tx.id, note);
              toast(res.ok ? { tone: "success", title: "Note saved" } : { tone: "error", title: "Couldn't save note" });
            }}
            rows={3}
            placeholder="Add a note…"
            className="w-full resize-none rounded-xl bg-fill p-3 text-[13px] outline-none placeholder:text-subtle focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
          />
        </div>
      </div>
    </Sheet>
  );
}
