"use client";

import * as React from "react";

interface CopilotCtx {
  /** False when no AI key is configured: every Copilot entry point is hidden. */
  enabled: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Open the drawer and send a question. */
  ask: (question: string) => void;
  pending: string | null;
  consumePending: () => string | null;
}

const Ctx = React.createContext<CopilotCtx | null>(null);

export function CopilotProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const value = React.useMemo<CopilotCtx>(
    () => ({
      enabled,
      open: enabled && open,
      setOpen: (o: boolean) => enabled && setOpen(o),
      toggle: () => enabled && setOpen((o) => !o),
      ask: (q) => {
        if (!enabled) return;
        setPending(q);
        setOpen(true);
      },
      pending,
      consumePending: () => {
        const p = pending;
        setPending(null);
        return p;
      },
    }),
    [enabled, open, pending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilot() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useCopilot must be used inside CopilotProvider");
  return ctx;
}
