import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/** Minimal KPI tile: hero number + quiet trend. `goodWhenUp` decides the trend tint. */
export function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  goodWhenUp = true,
  footnote,
  className,
}: {
  label: string;
  value: string;
  delta?: number | null;
  deltaLabel?: string;
  goodWhenUp?: boolean;
  footnote?: React.ReactNode;
  className?: string;
}) {
  const dir = delta === undefined || delta === null || Math.abs(delta) < 1e-9 ? 0 : delta > 0 ? 1 : -1;
  const good = dir === 0 ? null : dir > 0 === goodWhenUp;
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <div className={cn("animate-rise rounded-3xl bg-surface p-5 shadow-card", className)}>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-2 tabular text-[28px] leading-none font-semibold tracking-[-0.025em]">{value}</p>
      <div className="mt-3 flex min-h-5 items-center gap-1.5 text-[12.5px]">
        {deltaLabel && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 tabular font-medium",
              good === true && "text-positive",
              good === false && "text-negative",
              good === null && "text-muted",
            )}
          >
            <Icon className="size-3.5" strokeWidth={2.5} aria-label={dir > 0 ? "up" : dir < 0 ? "down" : "flat"} />
            {deltaLabel}
          </span>
        )}
        {footnote && <span className="truncate text-subtle">{footnote}</span>}
      </div>
    </div>
  );
}
