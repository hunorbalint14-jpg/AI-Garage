"use client";

import { useState, useTransition } from "react";
import { sendManualReminder } from "./actions";

// One-click REMIND → on pending quote rows (UX review §1f): fires the
// existing manual-reminder action over email. The quote detail page keeps
// the full channel picker for anything fancier.
export function RemindButton({ quoteId }: { quoteId: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  function run() {
    startTransition(async () => {
      const result = await sendManualReminder({ quoteId, channels: ["email"] });
      setState("error" in result ? "error" : "sent");
    });
  }

  if (state === "sent") {
    return <span className="font-mono text-[10px] font-semibold text-ws-green">Sent ✓</span>;
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={`rounded-[2px] border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-60 ${
        state === "error"
          ? "border-ws-red-border bg-ws-red-bg text-ws-red"
          : "border-ws-amber-border bg-ws-amber-bg text-ws-amber hover:bg-[#453519]"
      }`}
    >
      {pending ? "Sending…" : state === "error" ? "Failed — retry" : "Remind →"}
    </button>
  );
}
