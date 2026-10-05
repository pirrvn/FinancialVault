import { formatMoney, formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface BarListItem {
  key: string;
  label: string;
  valueCents: number;
  share: number;
  leading?: React.ReactNode;
  meta?: React.ReactNode;
  onClick?: () => void;
}

/**
 * Ranked, directly-labelled horizontal bars. Used instead of a donut for part-to-whole:
 * every row carries its label and value, so identity never relies on color.
 */
export function BarList({
  items,
  currency,
  className,
  barClassName = "bg-chart-out",
  max: maxProp,
}: {
  items: BarListItem[];
  currency: string;
  className?: string;
  barClassName?: string;
  /** Shared scale when a list is split across columns. */ max?: number;
}) {
  const max = maxProp ?? Math.max(1, ...items.map((i) => i.valueCents));
  return (
    <ul className={cn("space-y-1", className)}>
      {items.map((i) => (
        <li key={i.key}>
          <button
            type="button"
            onClick={i.onClick}
            disabled={!i.onClick}
            className="group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-fill disabled:hover:bg-transparent"
          >
            {i.leading}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium">{i.label}</span>
                <span className="shrink-0 tabular">{formatMoney(i.valueCents, currency, { decimals: false })}</span>
              </span>
              <span className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                  <span
                    className={cn("block h-full rounded-full transition-[width] duration-500 ease-[var(--ease-apple)]", barClassName)}
                    style={{ width: `${(i.valueCents / max) * 100}%` }}
                  />
                </span>
                <span className="w-9 text-right tabular text-[11px] text-subtle">{formatPercent(i.share)}</span>
              </span>
              {i.meta && <span className="mt-0.5 block text-[11.5px] text-subtle">{i.meta}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
