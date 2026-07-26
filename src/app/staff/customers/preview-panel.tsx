"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { sendReminder } from "./actions";
import {
  DeckRow,
  HealthAvatar,
  HealthRing,
  MONO_LABEL_CLASS,
  PlateChip,
  URGENCY_TEXT_CLASS,
  fmtGBP,
  fmtGBP0,
} from "./customers-ui";
import type { InsightAction } from "@/lib/customer-insights";

// The right-hand preview: everything needed to act on a customer without
// leaving the list. Read-only apart from the action rail, which runs the same
// server actions the record page uses — no parallel code path.

const STAT_LABEL_CLASS = "font-mono text-[9px] uppercase tracking-[0.12em] text-ws-text-3";

export function PreviewPanel({
  row,
  brandColor,
  onBrand,
  onClose,
}: {
  row: DeckRow;
  brandColor: string;
  onBrand: string;
  onClose: () => void;
}) {
  return (
    <aside
      className="animate-cd-slide-in overflow-hidden rounded-[10px] border border-ws-border bg-ws-card xl:sticky xl:top-0"
      aria-label={`Preview — ${row.name ?? "customer"}`}
    >
      <div className="flex items-center gap-3 border-b border-ws-border p-4">
        <HealthAvatar name={row.name} health={row.health} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-[#fafafa]">{row.name ?? "Unnamed customer"}</p>
          <p className="truncate font-mono text-[11.5px] text-ws-text-3">{row.contact}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="p-1 text-ws-text-3 transition-colors hover:text-ws-text"
        >
          <X className="h-[15px] w-[15px]" />
        </button>
      </div>

      <div className="flex items-center gap-[14px] border-b border-ws-border px-4 py-[14px]">
        <HealthRing health={row.health} size={56} r={25} stroke={5}>
          <span className="font-mono text-[14px] font-bold text-ws-text">{row.health}</span>
        </HealthRing>
        <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1">
          <Stat label="LIFETIME" value={fmtGBP0(row.lifetimeValue)} />
          <Stat label="VISITS" value={String(row.visitCount)} />
          <Stat label="ON ACCOUNT" value={row.balance > 0 ? fmtGBP(row.balance) : "£0"} />
          <Stat label="LAST IN" value={row.lastIn} />
        </div>
      </div>

      <div className="m-4 rounded-[10px] border border-ws-purple-border bg-ws-purple-bg p-3">
        <p className={`${MONO_LABEL_CLASS} mb-1.5 text-ws-purple`}>{"// AI BRIEF"}</p>
        <p className="text-[13px] leading-[1.55] text-ws-text">{row.brief}</p>
      </div>

      <ActionRail customerId={row.id} actions={row.actions} />

      {row.vehicles.length > 0 && (
        <div className="px-4 pb-[14px]">
          <p className={`${MONO_LABEL_CLASS} mb-1.5`}>VEHICLES</p>
          <div className="flex flex-col gap-1.5">
            {row.vehicles.map((v) => (
              <div
                key={v.registration}
                className="flex items-center justify-between gap-2 rounded-[8px] border border-ws-border px-2.5 py-[7px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <PlateChip reg={v.registration} />
                  <span className="truncate text-[12px] text-ws-text-2">{v.model}</span>
                </span>
                <span className={`whitespace-nowrap font-mono text-[11px] font-semibold ${URGENCY_TEXT_CLASS[v.urgency]}`}>
                  {v.due}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-ws-border p-4">
        <Link
          href={`/staff/customers/${row.id}`}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] text-sm font-semibold transition-colors hover:brightness-110"
          style={{ background: brandColor, color: onBrand }}
        >
          Open full record →
        </Link>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className={STAT_LABEL_CLASS}>{label}</p>
      <p className="text-[14px] font-semibold tabular-nums text-ws-text">{value}</p>
    </div>
  );
}

/**
 * Up to three next-best actions. Reminders send for real (same action as the
 * record page's Send reminder button) and report what actually went out;
 * anything conversational hands over to the record page's composer rather than
 * firing off AI-written text nobody read.
 */
function ActionRail({ customerId, actions }: { customerId: string; actions: InsightAction[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: InsightAction) {
    setError(null);
    setDone(null);
    if (action.kind === "draft") {
      router.push(`/staff/customers/${customerId}?draft=${encodeURIComponent(action.topic)}`);
      return;
    }
    if (action.kind === "plan") {
      router.push(`/staff/customers/${customerId}#membership`);
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

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 px-4 pb-[14px]">
      <p className={`${MONO_LABEL_CLASS} mb-0.5`}>NEXT BEST ACTIONS</p>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          disabled={pending}
          onClick={() => run(a)}
          className="flex w-full items-center justify-between gap-2 rounded-[8px] border border-ws-border bg-ws-hover px-3 py-2 text-left text-[13px] font-medium text-ws-text transition-colors hover:border-ws-text-3 disabled:opacity-50"
        >
          <span>{a.label}</span>
          <span className="flex-none text-ws-text-3">{running === a.key ? "…" : "→"}</span>
        </button>
      ))}
      {done && <p className="animate-cd-fade-up text-[12px] text-ws-green">✓ {done}</p>}
      {error && <p className="text-[12px] text-ws-red">{error}</p>}
    </div>
  );
}
