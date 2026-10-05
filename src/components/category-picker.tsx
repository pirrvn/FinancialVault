"use client";

import * as React from "react";
import { Popover } from "radix-ui";
import { Command, defaultFilter } from "cmdk";
import Link from "next/link";
import { Check, Sparkles, Wand2, Pencil, CircleAlert, Plus, Shapes } from "lucide-react";
import type { CategoryDTO } from "@/lib/services/queries";
import { CategoryIcon } from "./category-icon";
import { Switch } from "./ui/switch";
import { cn } from "@/lib/utils";

export type CategorySource = "RULE" | "AI" | "MANUAL" | "FALLBACK";

const KIND_LABEL: Record<CategoryDTO["kind"], string> = { EXPENSE: "expense", INCOME: "income", TRANSFER: "transfer" };

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
  onCreate,
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
  /** Create a category from the search text and assign it. Resolves once done (the picker stays open on failure). */
  onCreate?: (name: string, opts: { applyToSimilar: boolean; kind: CategoryDTO["kind"] }) => Promise<unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [applyToSimilar, setApplyToSimilar] = React.useState(true);
  const [query, setQuery] = React.useState("");
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const [creating, setCreating] = React.useState(false);
  const typed = query.trim();
  const canCreate = !!onCreate && typed.length > 0 && !categories.some((c) => c.name.toLowerCase() === typed.toLowerCase());
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
  // We filter and order ourselves so "Create" always comes last: cmdk selects the first item, and
  // Enter after typing "bar" must pick "Bars & Nightlife", not create a "bar" category.
  const visible = groups.map((g) => {
    const items = categories
      .filter((c) => c.kind === g.kind)
      .map((c) => ({ c, score: typed ? defaultFilter(c.name, typed, [g.label]) : 1 }))
      .filter((x) => x.score > 0);
    if (typed) items.sort((a, b) => b.score - a.score);
    return { ...g, items: items.map((x) => x.c) };
  });
  // Offer the direction's kind and "transfer" (savings, own accounts); the current kind comes first.
  const directionKind: CategoryDTO["kind"] = amountCents < 0 ? "EXPENSE" : "INCOME";
  const createKinds: CategoryDTO["kind"][] =
    categories.find((c) => c.id === value)?.kind === "TRANSFER" ? ["TRANSFER", directionKind] : [directionKind, "TRANSFER"];
  const create = async (kind: CategoryDTO["kind"]) => {
    if (!onCreate || creating) return;
    setCreating(true);
    try {
      await onCreate(typed, { applyToSimilar, kind });
    } finally {
      setCreating(false);
    }
  };
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
          <Command loop shouldFilter={false} className="flex flex-col">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              maxLength={40}
              placeholder="Move to or create a category…"
              className="h-11 border-b border-line bg-transparent px-4 text-[16px] outline-none placeholder:text-subtle sm:text-sm"
            />
            <Command.List className="max-h-72 scrollbar-thin overflow-y-auto p-1.5">
              {!canCreate && <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No category found.</Command.Empty>}
              {visible.map((g) =>
                g.items.length ? (
                  <Command.Group
                    key={g.kind}
                    heading={g.label}
                    className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase"
                  >
                    {g.items.map((c) => (
                      <Command.Item
                        key={c.id}
                        value={c.id}
                        onSelect={() => onSelect(c.id, { applyToSimilar })}
                        className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] data-[selected=true]:bg-fill-strong"
                      >
                        <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                        <span className="flex-1 truncate">{c.name}</span>
                        {c.id === value && <Check className="size-3.5 text-accent" />}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : null,
              )}
              {canCreate && (
                <Command.Group>
                  {createKinds.map((kind, i) => (
                    <Command.Item
                      key={kind}
                      value={`__create__${kind}`}
                      disabled={creating}
                      onSelect={() => create(kind)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-[13px] data-[disabled=true]:opacity-50 data-[selected=true]:bg-fill-strong"
                    >
                      <span className="flex size-6 items-center justify-center rounded-lg bg-accent/15 text-accent">
                        <Plus className="size-3.5" strokeWidth={2.5} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {i === 0 ? "Create " : "Create as "}
                        <span className="font-semibold">{i === 0 ? `“${typed}”` : KIND_LABEL[kind]}</span>
                        {i === 0 && <span className="text-subtle"> · {KIND_LABEL[kind]}</span>}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
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
          <Link
            href="/categories"
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-xs font-medium text-muted transition-colors hover:bg-fill hover:text-fg"
          >
            <Shapes className="size-3.5" /> Manage categories
          </Link>
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
