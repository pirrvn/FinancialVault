"use client";

import { useActionState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { loginAction } from "@/lib/auth-actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-8">
      <input type="hidden" name="next" value={next} />
      <input type="text" name="username" autoComplete="username" value="financevault" readOnly hidden />
      <div className="flex items-center gap-2 rounded-2xl bg-surface p-1.5 pl-4 shadow-card">
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Password"
          aria-label="Password"
          className="h-10 flex-1 bg-transparent text-[16px] outline-none placeholder:text-subtle"
        />
        <button
          type="submit"
          disabled={pending}
          aria-label="Sign in"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition hover:brightness-110 disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" strokeWidth={2.5} />}
        </button>
      </div>
      {state?.error && <p className="mt-3 text-[13px] text-negative">{state.error}</p>}
    </form>
  );
}
