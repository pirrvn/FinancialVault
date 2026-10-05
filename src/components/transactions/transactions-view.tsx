"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, CircleAlert, CheckCheck, X } from "lucide-react";
import type { CategoryDTO, TransactionDTO } from "@/lib/services/queries";
import { formatMoney } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import { foldText } from "@/lib/text";
import { confirmReviewAction, overrideCategoryAction } from "@/lib/actions";
import { cn } from "@/lib/utils";
import { CategoryChip, CategoryPicker } from "../category-picker";
import { Input, Kbd, Select } from "../ui/input";
import { Button } from "../ui/button";
import { useToast } from "../ui/toast";
import { PageHeader } from "../app-shell";
import { TransactionDetail } from "./transaction-detail";

const PAGE = 150;

export function TransactionsView({
  initial,
  categories,
  accounts,
}: {
  initial: TransactionDTO[];
  categories: CategoryDTO[];
  accounts: { id: string; name: string }[];
}) {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [txs, setTxs] = React.useState(initial);
  React.useEffect(() => setTxs(initial), [initial]);

  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState(params.get("category") ?? "");
  const [account, setAccount] = React.useState("");
  const [month, setMonth] = React.useState(params.get("month") ?? "");
  const [reviewOnly, setReviewOnly] = React.useState(params.get("review") === "1");
  const [limit, setLimit] = React.useState(PAGE);
  const [cursor, setCursor] = React.useState(-1);
  const [pickerFor, setPickerFor] = React.useState<string | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const deferredQuery = React.useDeferredValue(query);

  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const months = React.useMemo(() => [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort().reverse(), [txs]);
  const reviewCount = React.useMemo(() => txs.filter((t) => t.needsReview).length, [txs]);
  // Pre-fold once so filtering stays instant on thousands of rows.
  const searchIndex = React.useMemo(
    () =>
      new Map(
        txs.map((t) => [
          t.id,
          foldText(`${t.merchantName} ${t.rawDescription} ${t.categoryName} ${t.accountName} ${t.note ?? ""} ${(Math.abs(t.amountCents) / 100).toFixed(2)}`),
        ]),
      ),
    [txs],
  );

  const filtered = React.useMemo(() => {
    const q = foldText(deferredQuery);
    return txs.filter(
      (t) =>
        (!reviewOnly || t.needsReview) &&
        (!category || t.categoryId === category) &&
        (!account || t.accountId === account) &&
        (!month || t.date.startsWith(month)) &&
        (!q || searchIndex.get(t.id)!.includes(q)),
    );
  }, [txs, deferredQuery, reviewOnly, category, account, month, searchIndex]);
  const visible = filtered.slice(0, limit);
  const totals = React.useMemo(() => {
    let inC = 0,
      outC = 0;
    for (const t of filtered) t.amountCents > 0 ? (inC += t.amountCents) : (outC -= t.amountCents);
    return { inC, outC };
  }, [filtered]);

  React.useEffect(() => {
    setLimit(PAGE);
    setCursor(-1);
  }, [deferredQuery, reviewOnly, category, account, month]);

  const similarCount = React.useCallback(
    (t: TransactionDTO) =>
      txs.filter(
        (x) => x.id !== t.id && x.merchantKey === t.merchantKey && Math.sign(x.amountCents) === Math.sign(t.amountCents) && x.categorySource !== "MANUAL",
      ).length,
    [txs],
  );

  const recategorize = React.useCallback(
    async (t: TransactionDTO, categoryId: string, applyToSimilar: boolean) => {
      setPickerFor(null);
      const c = catById.get(categoryId);
      if (!c) return;
      const snapshot = txs;
      // Optimistic: mirror the server's learning semantics locally.
      setTxs((prev) =>
        prev.map((x) => {
          if (x.id === t.id) return { ...x, categoryId, categoryName: c.name, kind: c.kind, categorySource: "MANUAL", needsReview: false, confidence: 1 };
          if (applyToSimilar && x.merchantKey === t.merchantKey && Math.sign(x.amountCents) === Math.sign(t.amountCents) && x.categorySource !== "MANUAL")
            return { ...x, categoryId, categoryName: c.name, kind: c.kind, categorySource: "RULE", needsReview: false, confidence: 1 };
          return x;
        }),
      );
      const res = await overrideCategoryAction({ transactionId: t.id, categoryId, applyToSimilar, learn: true });
      if (!res.ok) {
        setTxs(snapshot);
        toast({ tone: "error", title: "Couldn't update category", description: res.error });
        return;
      }
      toast({
        tone: "success",
        title: `${t.merchantName} → ${c.name}`,
        description: `${res.data.updatedSimilar ? `${res.data.updatedSimilar} similar updated. ` : ""}Saved as a rule for future imports.`,
      });
      router.refresh();
    },
    [catById, router, toast, txs],
  );

  const confirm = React.useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      setTxs((prev) => prev.map((x) => (ids.includes(x.id) ? { ...x, needsReview: false } : x)));
      const res = await confirmReviewAction(ids);
      if (res.ok) toast({ tone: "success", title: `Confirmed ${res.data.count} transaction${res.data.count > 1 ? "s" : ""}` });
      router.refresh();
    },
    [router, toast],
  );

  // Power-user keys: / search · j/k move · c or ↵ categorize · y confirm · o details
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
      if (e.metaKey || e.ctrlKey || e.altKey || pickerFor || detailId) return;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && typing) {
        (el as HTMLInputElement).blur();
        return;
      }
      if (typing) return;
      const t = visible[cursor];
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(visible.length - 1, c + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if ((e.key === "c" || e.key === "Enter") && t) {
        e.preventDefault();
        setPickerFor(t.id);
      } else if (e.key === "y" && t?.needsReview) {
        e.preventDefault();
        void confirm([t.id]);
      } else if (e.key === "o" && t) {
        e.preventDefault();
        setDetailId(t.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, cursor, pickerFor, detailId, confirm]);

  React.useEffect(() => {
    if (cursor >= 0) document.getElementById(`tx-${visible[cursor]?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, visible]);

  const detail = detailId ? (txs.find((t) => t.id === detailId) ?? null) : null;
  const activeFilters = [category, account, month].filter(Boolean).length + (reviewOnly ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${filtered.length.toLocaleString()} shown · ${formatMoney(totals.inC, "EUR", { decimals: false })} in · ${formatMoney(totals.outC, "EUR", { decimals: false })} out`}
        actions={
          reviewOnly && filtered.some((t) => t.needsReview) ? (
            <Button variant="primary" size="sm" onClick={() => confirm(filtered.filter((t) => t.needsReview).map((t) => t.id))}>
              <CheckCheck /> Confirm all shown
            </Button>
          ) : null
        }
      />

      <div className="sticky top-12 z-20 -mx-2 mb-4 flex flex-wrap items-center gap-2 rounded-2xl px-2 py-2 glass md:top-0">
        <div className="relative min-w-[240px] flex-[1_1_320px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merchant, description, amount…"
            className="pr-10 pl-9"
          />
          {query ? (
            <button onClick={() => setQuery("")} className="absolute top-1/2 right-3 -translate-y-1/2 text-subtle hover:text-fg" aria-label="Clear search">
              <X className="size-4" />
            </button>
          ) : (
            <Kbd className="absolute top-1/2 right-3 -translate-y-1/2">/</Kbd>
          )}
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          <option value="">All time</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, "long")}
            </option>
          ))}
        </Select>
        <button
          onClick={() => setReviewOnly((r) => !r)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors",
            reviewOnly ? "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning" : "bg-fill text-muted hover:text-fg",
          )}
        >
          <CircleAlert className="size-3.5" /> Review <span className="tabular">{reviewCount}</span>
        </button>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCategory("");
              setAccount("");
              setMonth("");
              setReviewOnly(false);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-3xl bg-surface shadow-card">
        <div className="hidden grid-cols-[96px_minmax(0,1fr)_200px_minmax(0,160px)_120px] gap-4 border-b border-line px-6 py-3 text-[11.5px] font-medium tracking-wide text-subtle uppercase md:grid">
          <span>Date</span>
          <span>Merchant</span>
          <span>Category</span>
          <span>Account</span>
          <span className="text-right">Amount</span>
        </div>
        {visible.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted">
            {reviewOnly ? "Nothing left to review. Nice." : "No transactions match these filters."}
          </div>
        ) : (
          <ul role="listbox" aria-label="Transactions">
            {visible.map((t, i) => {
              const c = catById.get(t.categoryId);
              const showDay = i === 0 || visible[i - 1].date !== t.date;
              return (
                <li
                  key={t.id}
                  id={`tx-${t.id}`}
                  role="option"
                  aria-selected={cursor === i}
                  onClick={() => {
                    setCursor(i);
                    setDetailId(t.id);
                  }}
                  className={cn(
                    "group grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line px-4 py-3 transition-colors last:border-b-0 md:grid-cols-[96px_minmax(0,1fr)_200px_minmax(0,160px)_120px] md:px-6",
                    cursor === i ? "bg-fill-strong" : "hover:bg-fill",
                  )}
                >
                  <span className={cn("hidden tabular text-[13px] text-muted md:block", !showDay && "md:invisible")}>
                    {new Date(t.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{t.merchantName}</span>
                    <span className="block truncate text-[12px] text-subtle">
                      <span className="md:hidden">
                        {t.date}
                        {t.rawDescription !== t.merchantName && " · "}
                      </span>
                      {t.rawDescription !== t.merchantName && t.rawDescription}
                    </span>
                  </span>
                  <span className="order-last col-span-2 min-w-0 md:order-none md:col-span-1" onClick={(e) => e.stopPropagation()}>
                    <CategoryPicker
                      categories={categories}
                      value={t.categoryId}
                      amountCents={t.amountCents}
                      merchantName={t.merchantName}
                      similarCount={pickerFor === t.id ? similarCount(t) : 0}
                      open={pickerFor === t.id}
                      onOpenChange={(o) => setPickerFor(o ? t.id : null)}
                      onSelect={(id, opts) => recategorize(t, id, opts.applyToSimilar)}
                    >
                      <CategoryChip category={c} source={t.categorySource} needsReview={t.needsReview} aria-label={`Category: ${c?.name}. Change`} />
                    </CategoryPicker>
                  </span>
                  <span className="hidden truncate text-[13px] text-muted md:block">{t.accountName}</span>
                  <span className={cn("text-right tabular text-[14px] font-medium", t.amountCents > 0 && "text-positive")}>
                    {formatMoney(t.amountCents, t.currency, { sign: t.amountCents > 0 })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {filtered.length > limit && (
          <div className="border-t border-line p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show more · {(filtered.length - limit).toLocaleString()} remaining
            </Button>
          </div>
        )}
      </div>

      <p className="mt-4 hidden items-center justify-center gap-3 text-xs text-subtle md:flex">
        <span>
          <Kbd>J</Kbd> <Kbd>K</Kbd> move
        </span>
        <span>
          <Kbd>C</Kbd> categorize
        </span>
        <span>
          <Kbd>Y</Kbd> confirm
        </span>
        <span>
          <Kbd>O</Kbd> details
        </span>
        <span>
          <Kbd>/</Kbd> search
        </span>
      </p>

      <TransactionDetail
        tx={detail}
        category={detail ? catById.get(detail.categoryId) : undefined}
        onOpenChange={(o) => !o && setDetailId(null)}
        onRecategorize={() => {
          if (detail) {
            setDetailId(null);
            setTimeout(() => setPickerFor(detail.id), 50);
          }
        }}
        onConfirm={() => detail && confirm([detail.id])}
      />
    </>
  );
}
