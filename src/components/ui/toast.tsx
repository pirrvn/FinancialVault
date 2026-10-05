"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

const ToastContext = React.createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const I = Icon[t.tone];
          return (
            <div
              key={t.id}
              className="pointer-events-auto flex max-w-sm animate-[pop-in_0.35s_var(--ease-apple)] items-start gap-3 rounded-2xl px-4 py-3 shadow-float glass"
            >
              <I
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  t.tone === "success" && "text-positive",
                  t.tone === "error" && "text-negative",
                  t.tone === "info" && "text-accent",
                )}
              />
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs text-muted">{t.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
