"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, LoaderCircle, Lock, PartyPopper, Plus, SkipForward } from "lucide-react";
import type { CategoryDTO } from "@/lib/services/queries";
import type { ReviewGroup } from "@/lib/services/review";
import { overrideCategoryAction, quickCreateCategoryAction } from "@/lib/actions";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PageHeader } from "../app-shell";
import { CategoryIcon } from "../category-icon";
import { Kbd } from "../ui/input";
import { Segmented } from "../ui/segmented";
import { useToast } from "../ui/toast";

const fmtDate = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * One merchant at a time: pick a category once and FinanceVault remembers it for every past and
 * future transaction from that merchant. Suggestions are computed locally (no AI).
 */
export function ReviewView({
  groups: initial,
  categories: initialCategories,
  currency,
}: {
  groups: ReviewGroup[];
  categories: CategoryDTO[];
  currency: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [queue, setQueue] = React.useState(initial);
  const [categories, setCategories] = React.useState(initialCategories);
  const [done, setDone] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const total = React.useRef(initial.length);
  const group = queue[0];
  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const compatible = React.useMemo(() => {
    if (!group) return [];
    const debit = group.direction === "DEBIT";
    return categories.filter((c) => c.kind === "TRANSFER" || (debit ? c.kind === "EXPENSE" : c.kind === "INCOME"));
  }, [categories, group]);
  const suggested = group ? group.suggestions.slice(0, 3) : [];
  const others = compatible.filter((c) => !suggested.some((s) => s.categoryId === c.id)).sort((a, b) => a.name.localeCompare(b.name));

  // New categories default to the money direction's kind, or to "transfer" when it's filed as one now.
  const directionKind: CategoryDTO["kind"] = group?.direction === "DEBIT" ? "EXPENSE" : "INCOME";
  const [kindChoice, setKindChoice] = React.useState<CategoryDTO["kind"] | null>(null);
  const newKind = kindChoice ?? (group && catById.get(group.currentCategoryId)?.kind === "TRANSFER" ? "TRANSFER" : directionKind);

  const advance = React.useCallback(() => {
    setQueue((q) => q.slice(1));
    setDone((d) => d + 1);
    setNewName("");
    setKindChoice(null);
  }, []);

  const choose = React.useCallback(
    async (categoryId: string, created?: CategoryDTO) => {
      if (!group || busy) return;
      const category = created ?? catById.get(categoryId);
      setBusy(true);
      const res = await overrideCategoryAction({ transactionId: group.transactionIds[0], categoryId, applyToSimilar: true, learn: true });
      setBusy(false);
      if (!res.ok) {
        toast({ tone: "error", title: "Couldn't save", description: res.error });
        return;
      }
      toast({
        tone: "success",
        title: `${group.merchantName} → ${category?.name ?? "saved"}`,
        description: "Remembered for every past and future transaction.",
      });
      advance();
    },
    [advance, busy, catById, group, toast],
  );

  const create = async () => {
    const name = newName.trim();
    if (!group || !name) return;
    setBusy(true);
    const res = await quickCreateCategoryAction(name, newKind);
    setBusy(false);
    if (!res.ok) {
      toast({ tone: "error", title: "Couldn't create category", description: res.error });
      return;
    }
    const created: CategoryDTO = {
      ...res.data,
      kind: res.data.kind as CategoryDTO["kind"],
      isSystem: false,
      description: null,
      systemKey: null,
      archived: false,
    };
    setCategories((prev) => [...prev, created]);
    await choose(created.id, created);
  };

  const skip = () => setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]] : q));

  // Keyboard: 1–3 suggestions, K keep, S skip.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || e.metaKey || e.ctrlKey || e.altKey || !group) return;
      const n = Number(e.key);
      if (n >= 1 && n <= suggested.length) {
        e.preventDefault();
        void choose(suggested[n - 1].categoryId);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        void choose(group.currentCategoryId);
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    if (!group && done > 0) router.refresh();
  }, [group, done, router]);

  if (!group) {
    return (
      <>
        <PageHeader title="Review" />
        <div className="mx-auto flex max-w-md animate-rise flex-col items-center rounded-3xl bg-surface px-8 py-14 text-center shadow-card">
          <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-fill">
            <PartyPopper className="size-6 text-accent" />
          </span>
          <h2 className="text-[22px] font-semibold tracking-tight">All sorted</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            {done
              ? `You sorted ${done} merchant${done > 1 ? "s" : ""}. FinanceVault will file them on its own from now on.`
              : "Nothing waits for you. New merchants from your next statements will show up here."}
          </p>
          <Link
            href="/transactions"
            className="mt-6 inline-flex h-10 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-fg transition hover:brightness-110"
          >
            See transactions
          </Link>
        </div>
      </>
    );
  }

  const current = catById.get(group.currentCategoryId);
  const progress = total.current ? done / total.current : 0;

  return (
    <>
      <PageHeader title="Review" subtitle={`${queue.length} merchant${queue.length > 1 ? "s" : ""} to sort. Do it once; FinanceVault remembers.`} />
      <div className="mx-auto max-w-xl">
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-fill">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-apple)]"
            style={{ width: `${Math.max(4, progress * 100)}%` }}
          />
        </div>

        <div key={group.key} className="animate-rise rounded-3xl bg-surface p-5 shadow-card sm:p-6">
          <p className="text-[12px] font-medium tracking-wide text-subtle uppercase">{group.direction === "DEBIT" ? "Money out" : "Money in"}</p>
          <h2 className="mt-1 text-[26px] leading-tight font-semibold tracking-tight">{group.merchantName}</h2>
          <p className="mt-1 tabular text-[14px] text-muted">
            {group.count} transaction{group.count > 1 ? "s" : ""} · {formatMoney(group.totalCents, currency)}
            {" · "}
            {group.firstDate === group.lastDate ? fmtDate(group.firstDate) : `${fmtDate(group.firstDate)} – ${fmtDate(group.lastDate)}`}
          </p>
          <div className="mt-3 space-y-1">
            {group.samples.map((s) => (
              <p key={s} className="truncate rounded-lg bg-fill px-2.5 py-1.5 font-mono text-[11.5px] text-muted">
                {s}
              </p>
            ))}
          </div>

          {suggested.length > 0 && (
            <>
              <p className="mt-6 mb-2 text-[12px] font-medium tracking-wide text-muted uppercase">Suggested</p>
              <div className="space-y-2">
                {suggested.map((s, i) => {
                  const c = catById.get(s.categoryId);
                  if (!c) return null;
                  return (
                    <button
                      key={s.categoryId}
                      disabled={busy}
                      onClick={() => choose(s.categoryId)}
                      className="flex w-full items-center gap-3 rounded-2xl bg-fill px-3 py-3 text-left transition-colors hover:bg-fill-strong active:scale-[0.99] disabled:opacity-60"
                    >
                      <CategoryIcon icon={c.icon} color={c.color} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium">{c.name}</span>
                        <span className="block truncate text-[12px] text-subtle">{s.reason}</span>
                      </span>
                      <Kbd className="hidden sm:inline-flex">{i + 1}</Kbd>
                      <ChevronRight className="size-4 text-subtle sm:hidden" />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <p className="mt-6 mb-2 text-[12px] font-medium tracking-wide text-muted uppercase">All categories</p>
          <div className="flex flex-wrap gap-1.5">
            {others.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => choose(c.id)}
                className="inline-flex items-center gap-1.5 rounded-full bg-fill py-1 pr-3 pl-1 text-[13px] font-medium transition-colors hover:bg-fill-strong disabled:opacity-60"
              >
                <CategoryIcon icon={c.icon} color={c.color} size="sm" className="size-6 rounded-full" />
                {c.name}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              placeholder="New category…"
              aria-label="New category name"
              className="h-9 min-w-0 flex-1 rounded-xl bg-fill px-3 text-[16px] outline-none placeholder:text-subtle focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_25%,transparent)] sm:text-sm"
            />
            {newName.trim() && (
              <Segmented
                size="sm"
                aria-label="Type of the new category"
                value={newKind}
                onChange={setKindChoice}
                options={[
                  { value: directionKind, label: directionKind === "EXPENSE" ? "Expense" : "Income" },
                  { value: "TRANSFER" as const, label: "Transfer" },
                ]}
              />
            )}
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="inline-flex h-9 items-center gap-1 rounded-xl bg-fill px-3 text-[13px] font-medium disabled:opacity-40"
            >
              <Plus className="size-4" /> Create
            </button>
          </form>

          <div className="mt-6 flex items-center gap-2 border-t border-line pt-4">
            <button
              disabled={busy}
              onClick={() => choose(group.currentCategoryId)}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-fill px-3 text-[13px] font-medium transition-colors hover:bg-fill-strong disabled:opacity-60"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Keep “{current?.name ?? "current"}”
            </button>
            <button
              onClick={skip}
              disabled={busy || queue.length < 2}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-40",
              )}
            >
              <SkipForward className="size-4" /> Skip
            </button>
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[12px] text-subtle">
          <Lock className="size-3" /> Suggestions come from your own history, computed on your server. No AI involved.
        </p>
        <p className="mt-2 hidden items-center justify-center gap-3 text-xs text-subtle sm:flex">
          <span>
            <Kbd>1</Kbd>–<Kbd>3</Kbd> pick
          </span>
          <span>
            <Kbd>K</Kbd> keep
          </span>
          <span>
            <Kbd>S</Kbd> skip
          </span>
        </p>
      </div>
    </>
  );
}
