"use client";

import { useState, useTransition } from "react";
import { FlaskConical } from "lucide-react";
import { wipeDemoSandbox } from "@/app/staff/sandbox-actions";
import { useConfirm } from "@/components/confirm-provider";

// Persistent strip while demo rows exist (#506 PR 3). Everyone sees it —
// technicians need to know the board is sample data — but only owner/admin
// can wipe. Not dismissible: the wipe is the dismiss.
export function DemoDataBanner({ canWipe }: { canWipe: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  function handleWipe() {
    void confirm({
      title: "Wipe the sample data?",
      description:
        "Every row marked demo — customers, vehicles, bookings, jobs, the invoice and quote — is deleted. Real records are untouched.",
      confirmLabel: "Wipe sample data",
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      setError(null);
      startTransition(async () => {
        const res = await wipeDemoSandbox();
        if ("error" in res) setError(res.error);
      });
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-200">
      <FlaskConical className="h-4 w-4 flex-none text-amber-400" />
      <span className="flex-1">
        Sample data is loaded — rows wearing the <span className="rounded border border-amber-500/40 px-1 font-mono text-[10px] uppercase tracking-wider">demo</span> badge
        are here to explore with, not real work.
      </span>
      {error && <span className="text-red-300">{error}</span>}
      {canWipe && (
        <button
          type="button"
          onClick={handleWipe}
          disabled={pending}
          className="rounded-md border border-amber-500/40 px-2.5 py-1 font-semibold text-amber-100 hover:bg-amber-500/15 disabled:opacity-60"
        >
          {pending ? "Wiping…" : "Wipe sample data"}
        </button>
      )}
    </div>
  );
}
