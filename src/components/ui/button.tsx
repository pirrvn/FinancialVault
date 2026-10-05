import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_rgb(0_0_0/0.1)]",
  secondary: "bg-fill text-fg hover:bg-fill-strong",
  ghost: "text-muted hover:text-fg hover:bg-fill",
  danger: "text-negative hover:bg-[color-mix(in_srgb,var(--negative)_10%,transparent)]",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-9 px-4 text-sm rounded-xl gap-2",
  icon: "h-8 w-8 rounded-lg justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = "secondary", size = "md", ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center font-medium whitespace-nowrap transition-all duration-200 ease-[var(--ease-apple)] select-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4",
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
));
Button.displayName = "Button";
