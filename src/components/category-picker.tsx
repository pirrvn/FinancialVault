"use client";

import * as React from "react";
import { Popover } from "radix-ui";
import { Command } from "cmdk";
import { Check, Sparkles, Wand2, Pencil, CircleAlert } from "lucide-react";
import type { CategoryDTO } from "@/lib/services/queries";
import { CategoryIcon } from "./category-icon";
import { Switch } from "./ui/switch";
import { cn } from "@/lib/utils";

export type CategorySource = "RULE" | "AI" | "MANUAL" | "FALLBACK";

export function SourceGlyph({ source, needsReview }: { source: CategorySource; needsReview?: boolean }) {
  if (needsReview) return <CircleAlert className="size-3 text-warning" aria-label="Needs review" />;
  if (source === "AI") return <Sparkles className="size-3 text-subtle" aria-label="Categorized by AI" />;
  if (source === "MANUAL") return <Pencil className="size-3 text-subtle" aria-label="Set manually" />;
  if (source === "RULE") return <Wand2 className="size-3 text-subtle" aria-label="Matched a rule" />;
  return null;
}

/**
 * Inline one-click recategorization. Selecting a category saves it, learns a merchant rule and
 * (optionally) applies it to all similar history.
 */
export function CategoryPicker({
  categories,
  value,
  amountCents,
  similarCount,
  merchantName,
  onSelect,
  open,
  onOpenChange,
  children,
}: {
  categories: CategoryDTO[];
  value: string;
  amountCents: number;
  similarCount: number;
  merchantName: string;
  onSelect: (categoryId: string, opts: { applyToSimilar: boolean }) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [applyToSimilar, setApplyToSimilar] = React.useState(true);
  // Show the kinds compatible with the money direction first.
  const groups: { label: string; kind: CategoryDTO["kind"] }[] =
    amountCents < 0
      ? [
          { label: "Expenses", kind: "EXPENSE" },
          { label: "Transfers", kind: "TRANSFER" },
          { label: "Income", kind: "INCOME" },
        ]
      : [
          { label: "Income", kind: "INCOME" },
          { label: "Transfers", kind: "TRANSFER" },
          { label: "Expenses", kind: "EXPENSE" },
        ];
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-72 origin-[var(--radix-popover-content-transform-origin)] animate-[pop-in_0.25s_var(--ease-apple)] overflow-hidden rounded-2xl bg-surface shadow-float dark:bg-[#2c2c2e]"
          onClick={(e) => e.stopPropagation()}
        >
          <Command loop className="flex flex-col">
            <Command.Input
              autoFocus
              placeholder="Move to category…"
              className="h-11 border-b border-line bg-transparent px-4 text-sm outline-none placeholder:text-subtle"
            />
            <Command.List className="max-h-72 scrollbar-thin overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No category found.</Command.Empty>
              {groups.map((g) => (
                <Command.Group
                  key={g.kind}
                  heading={g.label}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase"
                >
                  {categories
                    .filter((c) => c.kind === g.kind)
                    .map((c) => (
                      <Command.Item
                        key={c.id}
                        value={`${c.name} ${c.kind}`}
                        onSelect={() => onSelect(c.id, { applyToSimilar })}
                        className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] data-[selected=true]:bg-fill-strong"
                      >
                        <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                        <span className="flex-1 truncate">{c.name}</span>
                        {c.id === value && <Check className="size-3.5 text-accent" />}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span className="min-w-0 text-xs">
              <span className="block font-medium">Remember for {merchantName}</span>
              <span className="block text-muted">
                {similarCount > 0 ? `Also update ${similarCount} similar transaction${similarCount > 1 ? "s" : ""}` : "Applies to future imports"}
              </span>
            </span>
            <Switch checked={applyToSimilar} onCheckedChange={setApplyToSimilar} />
          </label>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function CategoryChip({
  category,
  source,
  needsReview,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { category?: CategoryDTO; source: CategorySource; needsReview: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-[12.5px] font-medium transition-colors hover:bg-fill-strong",
        needsReview ? "bg-[color-mix(in_srgb,var(--warning)_12%,transparent)]" : "bg-fill",
        className,
      )}
    >
      {category && <CategoryIcon icon={category.icon} color={category.color} size="sm" className="size-5 rounded-full [&_svg]:size-3" />}
      <span className="truncate">{category?.name ?? "—"}</span>
      <SourceGlyph source={source} needsReview={needsReview} />
    </button>
  );
}
