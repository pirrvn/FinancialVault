import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-xl bg-fill px-3 text-sm transition-colors outline-none placeholder:text-subtle focus:bg-surface focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <span className={cn("relative inline-flex max-w-[220px] min-w-0 shrink-0", className)}>
    <select
      ref={ref}
      className="h-9 w-full cursor-pointer appearance-none truncate rounded-xl bg-fill pr-8 pl-3 text-sm transition-colors outline-none hover:bg-fill-strong focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)]"
      {...props}
    />
    <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-subtle" strokeWidth={2.2} />
  </span>
));

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line px-1 font-sans text-[11px] font-medium text-subtle",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

Select.displayName = "Select";
