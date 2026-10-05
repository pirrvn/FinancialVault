"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Slide-over panel (right side) with glass backdrop. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  width = "max-w-md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  width?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] data-[state=open]:animate-fade-in dark:bg-black/50" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-2 right-2 z-50 flex w-[calc(100vw-1rem)] flex-col rounded-3xl shadow-float glass outline-none sm:inset-y-3 sm:right-3",
            "data-[state=open]:animate-[sheet-in_0.45s_var(--ease-apple)]",
            width,
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div className="min-w-0">
              <Dialog.Title className="text-[17px] font-semibold tracking-tight">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-[13px] text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Panel</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="-mr-2 rounded-full p-1.5 text-muted transition-colors hover:bg-fill hover:text-fg" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
