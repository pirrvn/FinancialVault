"use client";

import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  className,
}: {
  label: React.ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted">{label}</span>
        <span className={cn("tabular font-medium", value === 0 ? "text-subtle" : "text-fg")}>{format(value)}</span>
      </div>
      <SliderPrimitive.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="relative flex h-5 touch-none items-center select-none"
      >
        <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-fill-strong">
          <SliderPrimitive.Range className="absolute h-full bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label={typeof label === "string" ? label : undefined}
          className="block size-5 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.25),0_0_0_0.5px_rgb(0_0_0/0.08)] transition-transform outline-none hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_35%,transparent)]"
        />
      </SliderPrimitive.Root>
    </div>
  );
}
