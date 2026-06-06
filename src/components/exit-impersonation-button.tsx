"use client";

import { useTransition } from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";
import { exitImpersonation } from "@/app/staff/dev/actions";

export function ExitImpersonationButton() {
  const [pending, start] = useTransition();
  return (
    <button
      onClick={() => start(async () => { await exitImpersonation(); })}
      disabled={pending}
      className="inline-flex items-center justify-center gap-1.5 rounded-full bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-black disabled:opacity-50"
    >
      {pending && <AigSpinner />}
      Exit
    </button>
  );
}
