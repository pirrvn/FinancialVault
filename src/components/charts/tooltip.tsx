"use client";

import { formatMoney } from "@/lib/money";

export interface TooltipRow {
  label: string;
  valueCents: number;
  color?: string;
  dashed?: boolean;
}

export function ChartTooltipCard({
  title,
  rows,
  currency = "EUR",
  footer,
}: {
  title: string;
  rows: TooltipRow[];
  currency?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-w-44 rounded-2xl px-3.5 py-2.5 text-[12.5px] shadow-float glass">
      <p className="mb-1.5 font-medium text-muted">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            {r.color && <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />}
            <span className="flex-1 text-muted">{r.label}</span>
            <span className="tabular font-medium text-fg">{formatMoney(r.valueCents, currency)}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 border-t border-line pt-2 text-muted">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "dot" | "line" | "dash" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.kind === "line" || i.kind === "dash" ? (
            <svg width="14" height="2" aria-hidden>
              <line x1="0" y1="1" x2="14" y2="1" stroke={i.color} strokeWidth="2" strokeDasharray={i.kind === "dash" ? "3 2" : undefined} />
            </svg>
          ) : (
            <span className="inline-block h-2 w-2 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export const axisMoney = (currency: string) => (v: number) => formatMoney(v, currency, { compact: true });
