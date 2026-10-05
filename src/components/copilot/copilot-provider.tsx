"use client";

import * as React from "react";

interface CopilotCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Open the drawer and send a question. */
  ask: (question: string) => void;
  pending: string | null;
  consumePending: () => string | null;
}

const Ctx = React.createContext<CopilotCtx | null>(null);

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const value = React.useMemo<CopilotCtx>(
    () => ({
      open,
      setOpen,
      toggle: () => setOpen((o) => !o),
      ask: (q) => {
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
    [open, pending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilot() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useCopilot must be used inside CopilotProvider");
  return ctx;
}
