"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Command } from "cmdk";
import { Dialog } from "radix-ui";
import {
  LayoutGrid,
  ListOrdered,
  UploadCloud,
  Lightbulb,
  LineChart,
  Wand2,
  Sparkles,
  Search,
  Moon,
  Sun,
  Monitor,
  Vault,
  CircleAlert,
  LogOut,
} from "lucide-react";
import { CopilotProvider, useCopilot } from "./copilot/copilot-provider";
import { logoutAction } from "@/lib/auth-actions";
import { CopilotDrawer } from "./copilot/copilot-drawer";
import { Kbd } from "./ui/input";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid, key: "o" },
  { href: "/transactions", label: "Transactions", icon: ListOrdered, key: "t" },
  { href: "/insights", label: "Insights", icon: Lightbulb, key: "i" },
  { href: "/forecast", label: "Forecast", icon: LineChart, key: "f" },
  { href: "/rules", label: "Rules", icon: Wand2, key: "r" },
  { href: "/import", label: "Import", icon: UploadCloud, key: "u" },
];

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function Shell({ children, reviewCount, canSignOut }: { children: React.ReactNode; reviewCount: number; canSignOut: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const copilot = useCopilot();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Global shortcuts: ⌘K palette, ⌘J copilot, "g" then a letter to navigate.
  React.useEffect(() => {
    let gPressed = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        copilot.toggle();
        return;
      }
      if (isTyping(e) || mod || e.altKey) return;
      if (e.key === "g") {
        gPressed = Date.now();
        return;
      }
      if (Date.now() - gPressed < 900) {
        const target = NAV.find((n) => n.key === e.key);
        if (target) {
          e.preventDefault();
          router.push(target.href);
        }
        gPressed = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copilot, router]);

  return (
    <div className="min-h-dvh md:pl-[244px]">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col border-r border-line px-3 py-5 glass md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-3">
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#1d1d1f] to-[#48484a] text-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] dark:from-[#f5f5f7] dark:to-[#c7c7cc] dark:text-black">
            <Vault className="size-4" strokeWidth={2.2} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight">FinanceVault</span>
        </Link>
        <button
          onClick={() => setPaletteOpen(true)}
          className="mb-4 flex h-9 items-center gap-2 rounded-xl bg-fill px-3 text-[13px] text-subtle transition-colors hover:bg-fill-strong"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-colors duration-150",
                  active ? "bg-fill-strong font-medium text-fg" : "text-muted hover:bg-fill hover:text-fg",
                )}
              >
                <n.icon className="size-[17px]" strokeWidth={active ? 2.2 : 1.8} />
                <span className="flex-1">{n.label}</span>
                {n.href === "/transactions" && reviewCount > 0 && (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 tabular text-[11px] font-semibold text-warning">
                    {reviewCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <button
            onClick={() => copilot.setOpen(true)}
            className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7A86C2]/15 to-[#4E9E9C]/15 px-3 py-3 text-left transition-all hover:from-[#7A86C2]/25 hover:to-[#4E9E9C]/25"
          >
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#7A86C2] to-[#4E9E9C] text-white">
              <Sparkles className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">Ask Copilot</span>
              <span className="block text-[11.5px] text-muted">Chat with your money</span>
            </span>
            <Kbd>⌘J</Kbd>
          </button>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <ThemeSwitch />
            </div>
            {canSignOut && (
              <form action={logoutAction}>
                <button
                  type="submit"
                  aria-label="Sign out"
                  title="Sign out"
                  className="flex size-8 items-center justify-center rounded-xl text-subtle transition-colors hover:bg-fill hover:text-fg"
                >
                  <LogOut className="size-3.5" />
                </button>
              </form>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line px-4 glass md:hidden">
        <Vault className="size-4" />
        <span className="flex-1 font-semibold tracking-tight">FinanceVault</span>
        <button onClick={() => setPaletteOpen(true)} className="rounded-full p-2 hover:bg-fill" aria-label="Search">
          <Search className="size-4" />
        </button>
        <button onClick={() => copilot.setOpen(true)} className="rounded-full p-2 hover:bg-fill" aria-label="Copilot">
          <Sparkles className="size-4" />
        </button>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)] glass md:hidden">
        {NAV.filter((n) => n.href !== "/rules").map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 px-2 text-[10px]", active ? "text-accent" : "text-subtle")}>
              <n.icon className="size-5" />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <main className="mx-auto w-full max-w-[1280px] px-4 pt-6 pb-24 sm:px-8 md:pt-10 md:pb-16">{children}</main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} reviewCount={reviewCount} />
      <CopilotDrawer />
    </div>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const options = [
    { value: "light", icon: Sun, label: "Light" },
    { value: "dark", icon: Moon, label: "Dark" },
    { value: "system", icon: Monitor, label: "System" },
  ];
  return (
    <div className="flex rounded-xl bg-fill p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          aria-label={o.label}
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-[10px] transition-all",
            mounted && theme === o.value ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.1)] dark:bg-[#3a3a3c]" : "text-subtle hover:text-fg",
          )}
        >
          <o.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function CommandPalette({ open, onOpenChange, reviewCount }: { open: boolean; onOpenChange: (o: boolean) => void; reviewCount: number }) {
  const router = useRouter();
  const copilot = useCopilot();
  const { setTheme, resolvedTheme } = useTheme();
  const [query, setQuery] = React.useState("");
  const run = (fn: () => void) => {
    onOpenChange(false);
    setQuery("");
    fn();
  };
  const itemCls = "data-[selected=true]:bg-fill-strong flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[14px]";
  const headCls =
    "[&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/20 backdrop-blur-[2px] dark:bg-black/50" />
        <Dialog.Content className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-[pop-in_0.25s_var(--ease-apple)] overflow-hidden rounded-3xl shadow-float glass outline-none">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">Navigate, run actions, or ask the Copilot.</Dialog.Description>
          <Command loop>
            <div className="flex items-center gap-3 border-b border-line px-5">
              <Search className="size-4 text-subtle" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                autoFocus
                placeholder="Search pages and actions, or ask a question…"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
              />
            </div>
            <Command.List className="max-h-[50vh] scrollbar-thin overflow-y-auto p-2">
              <Command.Empty className="p-0">
                {query && (
                  <button
                    onClick={() => run(() => copilot.ask(query))}
                    className="flex w-full items-center gap-3 rounded-xl bg-fill-strong px-3 py-2.5 text-left text-[14px]"
                  >
                    <Sparkles className="size-4 text-accent" /> Ask Copilot: <span className="truncate font-medium">{query}</span>
                  </button>
                )}
              </Command.Empty>
              {query.length > 3 && (
                <Command.Group heading="Copilot" className={headCls}>
                  <Command.Item value={`ask ${query}`} onSelect={() => run(() => copilot.ask(query))} className={itemCls}>
                    <Sparkles className="size-4 text-accent" /> Ask Copilot: <span className="truncate font-medium">{query}</span>
                  </Command.Item>
                </Command.Group>
              )}
              <Command.Group heading="Go to" className={headCls}>
                {NAV.map((n) => (
                  <Command.Item key={n.href} value={`go ${n.label}`} onSelect={() => run(() => router.push(n.href))} className={itemCls}>
                    <n.icon className="size-4 text-muted" />
                    <span className="flex-1">{n.label}</span>
                    <span className="flex gap-1">
                      <Kbd>G</Kbd>
                      <Kbd>{n.key.toUpperCase()}</Kbd>
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions" className={headCls}>
                <Command.Item value="review needs review uncategorized" onSelect={() => run(() => router.push("/transactions?review=1"))} className={itemCls}>
                  <CircleAlert className="size-4 text-warning" />
                  <span className="flex-1">Review flagged transactions</span>
                  {reviewCount > 0 && <span className="tabular text-xs text-muted">{reviewCount}</span>}
                </Command.Item>
                <Command.Item value="import upload statement" onSelect={() => run(() => router.push("/import"))} className={itemCls}>
                  <UploadCloud className="size-4 text-muted" /> Import statements
                </Command.Item>
                <Command.Item value="open copilot chat" onSelect={() => run(() => copilot.setOpen(true))} className={itemCls}>
                  <Sparkles className="size-4 text-muted" />
                  <span className="flex-1">Open Copilot</span>
                  <Kbd>⌘J</Kbd>
                </Command.Item>
                <Command.Item
                  value="toggle theme dark light mode"
                  onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
                  className={itemCls}
                >
                  {resolvedTheme === "dark" ? <Sun className="size-4 text-muted" /> : <Moon className="size-4 text-muted" />} Toggle appearance
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AppShell({ children, reviewCount, canSignOut }: { children: React.ReactNode; reviewCount: number; canSignOut: boolean }) {
  return (
    <CopilotProvider>
      <Shell reviewCount={reviewCount} canSignOut={canSignOut}>
        {children}
      </Shell>
    </CopilotProvider>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-8 flex animate-fade-in flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.022em] sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
