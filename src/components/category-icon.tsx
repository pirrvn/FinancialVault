import {
  ArrowLeftRight,
  Baby,
  Banknote,
  BriefcaseBusiness,
  CircleDashed,
  Coins,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Ticket,
  TramFront,
  TrendingUp,
  Undo2,
  UtensilsCrossed,
  Tag,
  Dumbbell,
  Car,
  Coffee,
  Wifi,
  Shirt,
  Music,
  Briefcase,
  Fuel,
  type LucideIcon,
} from "lucide-react";
import { colorOf } from "@/lib/palette";
import { cn } from "@/lib/utils";

export const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight,
  Baby,
  Banknote,
  BriefcaseBusiness,
  CircleDashed,
  Coins,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  PawPrint,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Repeat,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Ticket,
  TramFront,
  TrendingUp,
  Undo2,
  UtensilsCrossed,
  Tag,
  Dumbbell,
  Car,
  Coffee,
  Wifi,
  Shirt,
  Music,
  Briefcase,
  Fuel,
};

export function CategoryIcon({ icon, color, size = "md", className }: { icon: string; color: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = ICONS[icon] ?? Tag;
  const c = colorOf(color);
  const dims =
    size === "sm" ? "size-6 rounded-lg [&_svg]:size-3.5" : size === "lg" ? "size-10 rounded-xl [&_svg]:size-5" : "size-8 rounded-[10px] [&_svg]:size-4";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", dims, className)}
      style={{ background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c }}
    >
      <Icon strokeWidth={2} />
    </span>
  );
}

export function CategoryDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: colorOf(color) }} />;
}
