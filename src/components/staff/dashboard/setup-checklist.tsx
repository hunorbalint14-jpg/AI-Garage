"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, FlaskConical, Sparkles, X } from "lucide-react";
import type { SetupChecklist } from "@/lib/setup-checklist";
import { dismissSetupChecklist } from "@/app/staff/checklist-actions";
import { seedDemoSandbox } from "@/app/staff/sandbox-actions";
import { useConfirm } from "@/components/confirm-provider";

// Setup checklist card (#506 PR 2). Owner/admin only; every step derives from
// real data, so ticking happens by doing the thing. "Ask AI" primes the
// support assistant with the step's how-to via /staff?assist=…

function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

function Ring({ done, total }: { done: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const frac = total === 0 ? 0 : done / total;
  return (
    <svg viewBox="0 0 38 38" className="h-10 w-10 -rotate-90" aria-hidden>
      <circle cx="19" cy="19" r={r} fill="none" strokeWidth="4" className="stroke-border" />
      <circle
        cx="19"
        cy="19"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        className="stroke-[#5fdd9d] transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

export function SetupChecklistCard({ checklist, canDismiss }: { checklist: SetupChecklist; canDismiss: boolean }) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function handleSeed() {
    setSeedError(null);
    setSeeding(true);
    const res = await seedDemoSandbox();
    setSeeding(false);
    if ("error" in res) setSeedError(res.error);
  }

  function handleDismiss() {
    void confirm({
      title: "Hide the setup checklist?",
      description:
        "It hides for everyone in the organisation and won't come back. Everything you've already set up stays set up.",
      confirmLabel: "Hide checklist",
    }).then((ok) => {
      if (ok) startTransition(async () => void (await dismissSetupChecklist()));
    });
  }

  function copyBookingUrl() {
    const flash = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    // clipboard API needs a secure context — fall back for http dev.
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(checklist.bookingUrl).then(flash, () => legacyCopy(checklist.bookingUrl) && flash());
    } else if (legacyCopy(checklist.bookingUrl)) {
      flash();
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-[22px]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Ring done={checklist.done} total={checklist.total} />
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Getting set up · {checklist.done}/{checklist.total}
            </div>
            <div className="text-base font-semibold text-foreground">
              {checklist.done === 0 ? "Welcome — let's get you trading" : "Keep going — nearly there"}
            </div>
          </div>
        </div>
        {canDismiss && (
          <button
            type="button"
            onClick={handleDismiss}
            disabled={pending}
            aria-label="Hide the setup checklist"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
        {checklist.steps.map((s) => (
          <div
            key={s.key}
            className={`flex items-start gap-2.5 rounded-sm border border-transparent p-2.5 ${s.done ? "opacity-60" : "hover:border-border"}`}
          >
            <span
              className={`mt-0.5 grid h-4.5 w-4.5 flex-none place-items-center rounded-full border ${
                s.done ? "border-[#5fdd9d]/50 bg-[#5fdd9d]/15 text-[#5fdd9d]" : "border-border text-transparent"
              }`}
            >
              <Check className="h-3 w-3" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                {s.href && !s.done ? (
                  <Link href={s.href} className="text-[13px] font-semibold text-foreground underline-offset-2 hover:underline">
                    {s.label}
                  </Link>
                ) : (
                  <span className="text-[13px] font-semibold text-foreground">{s.label}</span>
                )}
                {s.optional && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">optional</span>
                )}
              </div>
              <div className="mt-[2px] text-xs leading-normal text-muted-foreground">{s.detail}</div>
              <div className="mt-1 flex items-center gap-3">
                {s.key === "booking" && checklist.bookingLive && (
                  <button
                    type="button"
                    onClick={copyBookingUrl}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3 w-3" /> {copied ? "Copied!" : "Copy link"}
                  </button>
                )}
                {!s.done && (
                  <Link
                    href={`/staff?assist=${encodeURIComponent(s.ask)}`}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Sparkles className="h-3 w-3" /> Ask AI
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {checklist.sandboxOffer && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3.5">
          <button
            type="button"
            onClick={() => void handleSeed()}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground hover:bg-accent disabled:opacity-60"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            {seeding ? "Loading sample data…" : "Explore with sample data"}
          </button>
          <span className="text-xs text-muted-foreground">
            Six customers, a week of bookings, jobs and an invoice — clearly badged, one click to wipe.
          </span>
          {seedError && <span className="text-xs text-red-400">{seedError}</span>}
        </div>
      )}
    </div>
  );
}
