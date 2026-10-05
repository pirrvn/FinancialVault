"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Search, Trash2, Sparkles, Pencil, Wand2, BookOpen } from "lucide-react";
import type { CategoryDTO } from "@/lib/services/queries";
import { createRuleAction, deleteRuleAction, reapplyRulesAction, updateRuleAction, type ActionResult } from "@/lib/actions";
import { foldText } from "@/lib/text";
import { Card } from "../ui/card";
import { Input, Select } from "../ui/input";
import { Button } from "../ui/button";
import { Segmented } from "../ui/segmented";
import { Switch } from "../ui/switch";
import { CategoryIcon } from "../category-icon";
import { PageHeader } from "../app-shell";
import { useToast } from "../ui/toast";
import { cn } from "@/lib/utils";

export interface RuleDTO {
  id: string;
  categoryId: string;
  field: "MERCHANT" | "DESCRIPTION";
  matchType: "CONTAINS" | "STARTS_WITH" | "EXACT" | "REGEX";
  pattern: string;
  direction: "ANY" | "DEBIT" | "CREDIT";
  source: "USER" | "LEARNED" | "AI" | "SYSTEM";
  priority: number;
  confidence: number | null;
  hitCount: number;
  isActive: boolean;
}

const SOURCES = {
  LEARNED: { label: "Learned", icon: Pencil, hint: "Created when you fixed a category" },
  USER: { label: "Yours", icon: Wand2, hint: "Rules you wrote" },
  AI: { label: "AI", icon: Sparkles, hint: "Saved AI decisions, so merchants are never re-sent" },
  SYSTEM: { label: "Built-in", icon: BookOpen, hint: "Keyword lexicon for French & EU merchants" },
} as const;

const MATCH_LABEL = { CONTAINS: "contains word", STARTS_WITH: "starts with", EXACT: "is exactly", REGEX: "matches regex" };

export function RulesView({ rules, categories }: { rules: RuleDTO[]; categories: CategoryDTO[] }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = React.useState<"ALL" | RuleDTO["source"]>("ALL");
  const [query, setQuery] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    pattern: "",
    categoryId: categories.find((c) => c.kind === "EXPENSE")?.id ?? "",
    field: "DESCRIPTION" as RuleDTO["field"],
    matchType: "CONTAINS" as RuleDTO["matchType"],
    direction: "ANY" as RuleDTO["direction"],
  });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const counts = rules.reduce<Record<string, number>>((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {});
  const q = foldText(query);
  const visible = rules.filter(
    (r) => (tab === "ALL" || r.source === tab) && (!q || foldText(r.pattern).includes(q) || foldText(catById.get(r.categoryId)?.name ?? "").includes(q)),
  );

  const run = <T,>(fn: () => Promise<ActionResult<T>>, success: (data: T) => string) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast({ tone: "error", title: res.error });
      else toast({ tone: "success", title: success(res.data) });
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title="Rules"
        subtitle="How FinanceVault decides categories. Higher tiers win: learned › yours › AI › built-in."
        actions={
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () => reapplyRulesAction(),
                (d) => `Re-applied rules · ${d.changed} updated`,
              )
            }
          >
            <RefreshCw className={cn(pending && "animate-spin")} /> Re-apply to history
          </Button>
        }
      />

      <Card className="mb-4 p-5">
        <p className="mb-3 text-[14px] font-semibold">New rule</p>
        <form
          className="flex flex-wrap items-center gap-2 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.pattern.trim()) return;
            run(
              () => createRuleAction({ ...form, applyToExisting: true }),
              (d) => `Rule saved · ${d.reapplied} transaction(s) updated`,
            );
            setForm((f) => ({ ...f, pattern: "" }));
          }}
        >
          <span className="text-muted">If</span>
          <Select value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value as RuleDTO["field"] })} aria-label="Field">
            <option value="DESCRIPTION">description</option>
            <option value="MERCHANT">merchant</option>
          </Select>
          <Select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value as RuleDTO["matchType"] })} aria-label="Match type">
            {Object.entries(MATCH_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input
            value={form.pattern}
            onChange={(e) => setForm({ ...form, pattern: e.target.value })}
            placeholder={form.matchType === "REGEX" ? "^PRLV .*EDF" : "UBER"}
            className="w-44 flex-1"
            aria-label="Pattern"
          />
          <Select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as RuleDTO["direction"] })} aria-label="Direction">
            <option value="ANY">any amount</option>
            <option value="DEBIT">money out</option>
            <option value="CREDIT">money in</option>
          </Select>
          <span className="text-muted">then</span>
          <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} aria-label="Category">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" size="md" disabled={pending || !form.pattern.trim()}>
            <Plus /> Add
          </Button>
        </form>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "ALL", label: `All ${rules.length}` },
            ...(["LEARNED", "USER", "AI", "SYSTEM"] as const).map((s) => ({ value: s, label: `${SOURCES[s].label} ${counts[s] ?? 0}` })),
          ]}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter rules" className="pl-9" />
        </div>
      </div>
      {tab !== "ALL" && <p className="mb-3 px-1 text-[13px] text-muted">{SOURCES[tab].hint}</p>}

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-muted">No rules here yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.slice(0, 400).map((r) => {
              const c = catById.get(r.categoryId);
              const S = SOURCES[r.source];
              return (
                <li key={r.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", !r.isActive && "opacity-50")}>
                  <S.icon className="size-4 shrink-0 text-subtle" aria-label={S.label} />
                  <div className="min-w-0 flex-1 text-[13.5px]">
                    <span className="text-muted">
                      {r.field === "MERCHANT" ? "Merchant" : "Description"} {MATCH_LABEL[r.matchType]}{" "}
                    </span>
                    <code className="rounded-md bg-fill px-1.5 py-0.5 font-mono text-[12.5px]">{r.pattern}</code>
                    {r.direction !== "ANY" && <span className="text-subtle"> · {r.direction === "DEBIT" ? "money out" : "money in"}</span>}
                    {r.confidence !== null && r.source === "AI" && <span className="text-subtle"> · {Math.round(r.confidence * 100)}%</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c && <CategoryIcon icon={c.icon} color={c.color} size="sm" />}
                    <select
                      value={r.categoryId}
                      onChange={(e) =>
                        run(
                          () => updateRuleAction(r.id, { categoryId: e.target.value }),
                          () => "Rule updated",
                        )
                      }
                      className="rounded-lg bg-transparent py-1 pr-1 text-[13px] font-medium outline-none hover:bg-fill"
                      aria-label="Rule category"
                    >
                      {categories.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="w-16 text-right tabular text-[12px] text-subtle">{r.hitCount} hits</span>
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={(v) =>
                      run(
                        () => updateRuleAction(r.id, { isActive: v }),
                        () => (v ? "Rule enabled" : "Rule disabled"),
                      )
                    }
                    aria-label="Active"
                  />
                  {r.source === "SYSTEM" ? (
                    <span className="w-6" title="Built-in rules can be disabled but not deleted" />
                  ) : (
                    <button
                      onClick={() =>
                        run(
                          () => deleteRuleAction(r.id),
                          () => "Rule deleted",
                        )
                      }
                      className="p-1 text-subtle hover:text-negative"
                      aria-label="Delete rule"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
