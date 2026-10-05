"use client";

import * as React from "react";
import { Check, Trash2, EyeOff, LoaderCircle } from "lucide-react";
import type { CategoryDTO } from "@/lib/services/queries";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "@/lib/actions";
import { PALETTE, PALETTE_KEYS } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { Sheet } from "../ui/sheet";
import { Input, Select } from "../ui/input";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { CategoryIcon, ICONS } from "../category-icon";
import { useToast } from "../ui/toast";

type Kind = CategoryDTO["kind"];
export interface CategoryWithStats extends CategoryDTO {
  transactionCount: number;
  ruleCount: number;
  /** Fallback categories: renamable, never removable. */
  isProtected: boolean;
}
const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: "EXPENSE", label: "Expense" },
  { value: "INCOME", label: "Income" },
  { value: "TRANSFER", label: "Transfer" },
];
const KIND_HINT: Record<Kind, string> = {
  EXPENSE: "Counts as spending.",
  INCOME: "Counts as income.",
  TRANSFER: "Money moving between your own accounts or into savings. Not spending, not income.",
};
const DESCRIPTION_EXAMPLES: Record<Kind, string> = {
  EXPENSE: "e.g. Bars and terraces with friends: beers, apéro, planches",
  INCOME: "e.g. Babysitting and tutoring paid by Lydia or Wero",
  TRANSFER: "e.g. Money I move to my Revolut account",
};

/**
 * Create or edit a category. Deleting asks where the transactions should go; built-in categories
 * are hidden instead of deleted.
 */
export function CategoryEditor({
  open,
  onOpenChange,
  category,
  categories,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create */
  category: CategoryWithStats | null;
  categories: CategoryWithStats[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("EXPENSE");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState(PALETTE_KEYS[0]);
  const [icon, setIcon] = React.useState("Tag");
  const [deleting, setDeleting] = React.useState(false);
  const [target, setTarget] = React.useState("");
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setKind(category?.kind ?? "EXPENSE");
    setDescription(category?.description ?? "");
    setColor(category?.color ?? PALETTE_KEYS.find((k) => !categories.some((c) => c.color === k)) ?? PALETTE_KEYS[0]);
    setIcon(category?.icon ?? "Tag");
    setDeleting(false);
    setTarget("");
  }, [open, category, categories]);

  const isProtected = !!category?.isProtected;
  const kindLocked = !!category && (!!category.systemKey || category.transactionCount > 0);
  const targets = categories.filter((c) => !c.archived && c.kind === (category?.kind ?? kind) && c.id !== category?.id);
  const needsTarget = !!category && category.transactionCount + category.ruleCount > 0;
  const hides = !!category?.systemKey;

  const save = () =>
    startTransition(async () => {
      const payload = { name: name.trim(), kind, color, icon, description: description.trim() || null };
      const res = category ? await updateCategoryAction(category.id, payload) : await createCategoryAction(payload);
      if (!res.ok) {
        toast({ tone: "error", title: res.error });
        return;
      }
      toast({ tone: "success", title: category ? "Category saved" : `“${payload.name}” created` });
      onOpenChange(false);
      onSaved();
    });

  const remove = () =>
    startTransition(async () => {
      if (!category) return;
      const res = await deleteCategoryAction(category.id, needsTarget ? target : null);
      if (!res.ok) {
        toast({ tone: "error", title: res.error });
        return;
      }
      toast({
        tone: "success",
        title: hides ? `“${category.name}” hidden` : `“${category.name}” deleted`,
        description: res.data.moved ? `${res.data.moved} transaction${res.data.moved > 1 ? "s" : ""} moved to ${res.data.target}.` : undefined,
      });
      onOpenChange(false);
      onSaved();
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={category ? "Edit category" : "New category"}
      description={category?.systemKey ? "Built-in category" : undefined}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save();
        }}
      >
        <div className="flex-1 scrollbar-thin space-y-6 overflow-y-auto px-6 pb-6">
          <div className="flex items-center gap-3 rounded-2xl bg-fill p-3">
            <CategoryIcon icon={icon} color={color} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{name.trim() || "Category name"}</p>
              <p className="text-[12px] text-muted">{KIND_OPTIONS.find((k) => k.value === kind)?.label}</p>
            </div>
          </div>

          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bars & Nightlife" maxLength={40} autoFocus={!category} />
          </Field>

          <Field
            label="Type"
            hint={
              kindLocked
                ? category?.systemKey
                  ? "Built-in categories keep their type."
                  : "Move its transactions elsewhere to change the type."
                : KIND_HINT[kind]
            }
          >
            <div className={cn(kindLocked && "pointer-events-none opacity-50")}>
              <Segmented value={kind} onChange={setKind} options={KIND_OPTIONS} />
            </div>
          </Field>

          <Field label="What goes here?" hint="Gemini reads this when it files new merchants, so be specific: places, brands, habits.">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder={DESCRIPTION_EXAMPLES[kind]}
              className="w-full resize-none rounded-xl bg-fill p-3 text-[16px] outline-none placeholder:text-subtle focus:bg-surface focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)] sm:text-[14px]"
            />
          </Field>

          <Field label="Color">
            <div className="flex flex-wrap gap-2">
              {PALETTE_KEYS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  aria-pressed={color === k}
                  onClick={() => setColor(k)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110",
                    color === k && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
                  )}
                  style={{ background: PALETTE[k] }}
                >
                  {color === k && <Check className="size-3.5 text-white" strokeWidth={3} />}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Icon">
            <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-8">
              {Object.keys(ICONS).map((k) => {
                const I = ICONS[k];
                return (
                  <button
                    key={k}
                    type="button"
                    aria-label={k}
                    aria-pressed={icon === k}
                    onClick={() => setIcon(k)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-xl transition-colors",
                      icon === k ? "bg-accent text-accent-fg" : "bg-fill text-muted hover:bg-fill-strong hover:text-fg",
                    )}
                  >
                    <I className="size-[18px]" />
                  </button>
                );
              })}
            </div>
          </Field>

          {category && !isProtected && (
            <div className="rounded-2xl border border-line p-4">
              {!deleting ? (
                <button type="button" onClick={() => setDeleting(true)} className="inline-flex items-center gap-2 text-[13px] font-medium text-negative">
                  {hides ? <EyeOff className="size-4" /> : <Trash2 className="size-4" />} {hides ? "Hide this category" : "Delete this category"}
                </button>
              ) : (
                <div className="space-y-3 text-[13px]">
                  <p>
                    {needsTarget
                      ? `${category.transactionCount} transaction${category.transactionCount === 1 ? "" : "s"} and ${category.ruleCount} rule${category.ruleCount === 1 ? "" : "s"} will move to:`
                      : "Nothing uses this category yet."}
                    {hides && <span className="text-muted"> Built-in categories are hidden, and you can restore them later.</span>}
                  </p>
                  {needsTarget && (
                    <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Move to" className="w-full max-w-none">
                      <option value="">Choose a category…</option>
                      {targets.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={pending || (needsTarget && !target)}
                      onClick={remove}
                      className="bg-[color-mix(in_srgb,var(--negative)_10%,transparent)]"
                    >
                      {hides ? "Hide" : "Delete"}
                      {needsTarget && " and move"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {isProtected && <p className="text-[12px] text-muted">Uncategorized transactions land here, so this category can be renamed but not removed.</p>}
        </div>
        <div className="flex gap-2 border-t border-line px-6 py-4">
          <Button type="submit" variant="primary" disabled={pending || !name.trim()} className="flex-1 justify-center">
            {pending && <LoaderCircle className="animate-spin" />}
            {category ? "Save" : "Create category"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[12px] font-medium tracking-wide text-muted uppercase">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-[12px] text-subtle">{hint}</p>}
    </div>
  );
}
