"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full bg-fill-strong transition-colors duration-200 data-[state=checked]:bg-positive",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-[18px] w-[18px] translate-x-[2px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] transition-transform duration-200 ease-[var(--ease-apple)] data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
