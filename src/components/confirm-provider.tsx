"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";

// Promise-based replacement for window.confirm(): styled, mobile-friendly, and
// with room for consequence detail. Mounted once in the root layout, so any
// client component can do:
//
//   const confirm = useConfirm();
//   if (!(await confirm({ title: "Cancel this quote?", description: "…" }))) return;
//
// Name the entity in the title ("Delete bay 'MOT Bay'?"), put the consequence
// in the description, and set destructive for irreversible actions.

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Confirm button label. Default "Confirm". */
  confirmLabel?: string;
  /** Cancel button label. Default "Cancel". */
  cancelLabel?: string;
  /** Red confirm button for destructive / irreversible actions. */
  destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<{ resolve: (value: boolean) => void } | null>(null);
  // Options live in their own state and survive settle(), so the text doesn't
  // vanish a frame before the closing dialog does.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => setPending({ resolve }));
  }, []);

  function settle(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={!!pending} onOpenChange={(open) => !open && settle(false)}>
        {options && (
          <AlertDialogContent>
            <AlertDialogTitle>{options.title}</AlertDialogTitle>
            {options.description && (
              <AlertDialogDescription>{options.description}</AlertDialogDescription>
            )}
            <AlertDialogFooter>
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/10"
              >
                {options.cancelLabel ?? "Cancel"}
              </button>
              {/* No autoFocus on confirm: initial focus lands on Cancel (first
                  in DOM), so a stray Enter can't fire a destructive action. */}
              <button
                type="button"
                onClick={() => settle(true)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
                  options.destructive
                    ? "bg-red-600 hover:bg-red-500"
                    : "bg-green-600 hover:bg-green-500"
                }`}
              >
                {options.confirmLabel ?? "Confirm"}
              </button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
