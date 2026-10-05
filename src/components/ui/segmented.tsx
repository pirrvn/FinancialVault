"use client";

import { cn } from "@/lib/utils";

/** iOS-style segmented control. */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  size = "md",
  disabled = false,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn("inline-flex rounded-[10px] bg-fill p-0.5", disabled && "opacity-50", className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            // Never a submit button, even inside a <form>.
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-lg font-medium transition-all duration-200 ease-[var(--ease-apple)]",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
              active ? "bg-surface text-fg shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_var(--line)] dark:bg-[#3a3a3c]" : "text-muted enabled:hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
