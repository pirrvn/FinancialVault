"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus, Sparkles, LoaderCircle, ArchiveRestore } from "lucide-react";
import { recategorizeWithAiAction, restoreCategoryAction } from "@/lib/actions";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Sheet } from "../ui/sheet";
import { PageHeader } from "../app-shell";
import { CategoryIcon } from "../category-icon";
import { useToast } from "../ui/toast";
import { CategoryEditor, type CategoryWithStats } from "./category-editor";

const SECTIONS: { kind: CategoryWithStats["kind"]; title: string; subtitle: string }[] = [
  { kind: "EXPENSE", title: "Expenses", subtitle: "What counts as spending" },
  { kind: "INCOME", title: "Income", subtitle: "Money coming in" },
  { kind: "TRANSFER", title: "Transfers", subtitle: "Between your own accounts and into savings. Never counted as spending." },
];

export function CategoriesView({ categories, aiEnabled, reviewCount }: { categories: CategoryWithStats[]; aiEnabled: boolean; reviewCount: number }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = React.useState<CategoryWithStats | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const visible = categories.filter((c) => !c.archived);
  const hidden = categories.filter((c) => c.archived);

  const open = (c: CategoryWithStats | null) => {
    setEditing(c);
    setEditorOpen(true);
  };

  const runAi = (scope: "flagged" | "all") =>
    startTransition(async () => {
      const res = await recategorizeWithAiAction(scope);
      if (!res.ok) {
        toast({ tone: "error", title: "AI re-categorization failed", description: res.error });
        return;
      }
      setAiOpen(false);
      toast({
        tone: "success",
        title: `${res.data.updated} transaction${res.data.updated === 1 ? "" : "s"} re-checked`,
        description: `${res.data.byAi} filed by AI${res.data.stillFlagged ? `, ${res.data.stillFlagged} still need your eye` : ""}.`,
      });
      router.refresh();
    });

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Make them fit your life. Descriptions help the AI file things where you would."
        actions={
          <>
            <Button size="sm" onClick={() => setAiOpen(true)}>
              <Sparkles className="text-accent" /> Re-categorize with AI
            </Button>
            <Button size="sm" variant="primary" onClick={() => open(null)}>
              <Plus /> New category
            </Button>
          </>
        }
      />

      <div className="space-y-8">
        {SECTIONS.map((s) => {
          const items = visible.filter((c) => c.kind === s.kind);
          return (
            <section key={s.kind}>
              <div className="mb-3 px-1">
                <h2 className="text-[17px] font-semibold tracking-tight">{s.title}</h2>
                <p className="text-[13px] text-muted">{s.subtitle}</p>
              </div>
              <Card className="overflow-hidden">
                <ul className="grid grid-cols-1 md:grid-cols-2">
                  {items.map((c) => (
                    <li key={c.id} className="border-b border-line md:odd:border-r">
                      <button onClick={() => open(c)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-fill">
                        <CategoryIcon icon={c.icon} color={c.color} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{c.name}</span>
                          <span className="line-clamp-1 text-[12px] text-subtle">{c.description || "No description yet"}</span>
                        </span>
                        <span className="shrink-0 tabular text-[12px] text-muted">{c.transactionCount}</span>
                        <ChevronRight className="size-4 shrink-0 text-subtle" />
                      </button>
                    </li>
                  ))}
                  <li className="border-b border-line md:odd:border-r">
                    <button
                      onClick={() => {
                        setEditing(null);
                        setEditorOpen(true);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[14px] font-medium text-accent transition-colors hover:bg-fill"
                    >
                      <span className="flex size-8 items-center justify-center rounded-[10px] bg-accent/12">
                        <Plus className="size-4" />
                      </span>
                      Add a category
                    </button>
                  </li>
                </ul>
              </Card>
            </section>
          );
        })}

        {hidden.length > 0 && (
          <section>
            <div className="mb-3 px-1">
              <h2 className="text-[17px] font-semibold tracking-tight">Hidden</h2>
              <p className="text-[13px] text-muted">Built-in categories you removed. Restore one to use it again.</p>
            </div>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {hidden.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-3 opacity-70">
                    <CategoryIcon icon={c.icon} color={c.color} />
                    <span className="flex-1 truncate text-[14px]">{c.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const res = await restoreCategoryAction(c.id);
                          toast(res.ok ? { tone: "success", title: `“${c.name}” restored` } : { tone: "error", title: res.error });
                          router.refresh();
                        })
                      }
                    >
                      <ArchiveRestore /> Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}
      </div>

      <CategoryEditor open={editorOpen} onOpenChange={setEditorOpen} category={editing} categories={categories} onSaved={() => router.refresh()} />

      <Sheet open={aiOpen} onOpenChange={setAiOpen} title="Re-categorize with AI" description="Your manual choices and your own rules are never changed.">
        <div className="space-y-3 px-6 pb-6">
          {!aiEnabled ? (
            <p className="rounded-2xl bg-fill p-4 text-[13px] leading-relaxed text-muted">
              AI isn&apos;t set up yet. In Vercel, add a <span className="font-mono text-fg">GEMINI_API_KEY</span> environment variable (free key at
              aistudio.google.com/apikey), then redeploy.
            </p>
          ) : (
            <>
              <AiOption
                title="Transactions to review"
                detail={
                  reviewCount
                    ? `Ask Gemini about the ${reviewCount} transaction${reviewCount === 1 ? "" : "s"} flagged for review.`
                    : "Nothing is flagged right now."
                }
                disabled={pending || reviewCount === 0}
                onClick={() => runAi("flagged")}
              />
              <AiOption
                title="Everything the AI decided"
                detail="Forget past AI choices and ask again with your current categories and descriptions. Use this after adding a category such as Bars or Canteen."
                disabled={pending}
                onClick={() => runAi("all")}
              />
              {pending && (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <LoaderCircle className="size-4 animate-spin" /> Asking Gemini. This can take a minute.
                </p>
              )}
            </>
          )}
        </div>
      </Sheet>
    </>
  );
}

function AiOption({ title, detail, disabled, onClick }: { title: string; detail: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-fill p-4 text-left transition-colors hover:bg-fill-strong disabled:opacity-50"
    >
      <p className="flex items-center gap-2 text-[14px] font-medium">
        <Sparkles className="size-4 text-accent" /> {title}
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{detail}</p>
    </button>
  );
}
