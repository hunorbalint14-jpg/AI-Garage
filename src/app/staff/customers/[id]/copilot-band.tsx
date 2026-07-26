"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { InsightAction } from "@/lib/customer-insights";
import { MONO_LABEL_CLASS } from "../customers-ui";
import { sendReminder } from "../actions";

// The full-width copilot band at the top of a customer record: what the numbers
// say, and the two or three things worth doing about it. Every chip runs an
// action that already exists — reminders send, conversational ones hand the
// staff member the composer with a topic in it (they still write and read the
// message before anything leaves the building).

export function CopilotBand({ brief, actions }: { brief: string; actions: InsightAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function run(action: InsightAction) {
    setError(null);
    setDone(null);
    if (action.kind === "draft") {
      const params = new URLSearchParams(window.location.search);
      params.set("draft", action.topic);
      router.replace(`?${params.toString()}`, { scroll: false });
      scrollTo("compose");
      return;
    }
    if (action.kind === "plan") {
      scrollTo("membership");
      return;
    }
    if (action.kind === "link") {
      router.push(action.href);
      return;
    }
    setRunning(action.key);
    startTransition(async () => {
      const result = await sendReminder(action.vehicleId, action.reminderType);
      setRunning(null);
      if ("error" in result) setError(result.error);
      else setDone(`Sent — ${result.channels.join(" + ")}`);
    });
  }

  return (
    <section className="rounded-[12px] border border-ws-purple-border bg-[linear-gradient(180deg,#2a1a2a_0%,#20151f_100%)] px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className={`${MONO_LABEL_CLASS} text-ws-purple`}>{"// AI COPILOT · NEXT BEST ACTIONS"}</h2>
        <span className="font-mono text-[10px] tracking-[0.1em] text-ws-text-3">
          BASED ON DUE DATES, OPENS &amp; VISIT PATTERN
        </span>
      </div>

      <p className="mb-3 max-w-[760px] text-[13.5px] leading-[1.55] text-ws-text">{brief}</p>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              disabled={pending}
              onClick={() => run(a)}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-ws-purple-border bg-[rgba(201,143,201,0.1)] px-3 py-[7px] text-[13px] font-medium text-[#e6d5e6] transition-colors hover:border-ws-purple hover:bg-[rgba(201,143,201,0.2)] disabled:opacity-50"
            >
              {a.label}
              {running === a.key && <span className="text-ws-text-3">…</span>}
            </button>
          ))}
        </div>
      )}

      {done && <p className="animate-cd-fade-up mt-2.5 text-[12.5px] text-ws-green">✓ {done}</p>}
      {error && <p className="mt-2.5 text-[12.5px] text-ws-red">{error}</p>}
    </section>
  );
}
