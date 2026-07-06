import type { TicketStatus } from "@/lib/support-tickets-shared";
import { STATUS_LABELS } from "@/lib/support-tickets-shared";

// Dark-adjusted status pills from the design handoff table (+ declined from
// the reference implementation). Single source for every widget view.
export const STATUS_PILL: Record<TicketStatus, { bg: string; cl: string }> = {
  open:        { bg: "rgba(120,53,15,.3)",    cl: "#fcd34d" },
  needs_info:  { bg: "rgba(30,58,138,.3)",    cl: "#93c5fd" },
  in_progress: { bg: "rgba(76,29,149,.35)",   cl: "#d8b4fe" },
  planned:     { bg: "rgba(12,74,110,.4)",    cl: "#7dd3fc" },
  resolved:    { bg: "rgba(20,83,45,.35)",    cl: "#86efac" },
  closed:      { bg: "rgba(255,255,255,.06)", cl: "#d1d5db" },
  declined:    { bg: "rgba(127,29,29,.25)",   cl: "#fca5a5" },
};

export function StatusPill({ status }: { status: TicketStatus }) {
  const s = STATUS_PILL[status];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: s.bg, color: s.cl }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
