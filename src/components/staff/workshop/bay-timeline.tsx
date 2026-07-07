import Link from "next/link";
import type { ReactNode } from "react";
import type { BayRow, BookingSlot } from "@/lib/dashboard";

// Shared bay timeline (UX review §1d): promoted from the dashboard's
// TodaySchedule so the dashboard and the bookings Schedule render the SAME
// component — one file owns the block styles and status colours.

const BOOKING_STATUS: Record<string, { bg: string; border: string; accent: string }> = {
  scheduled:   { bg: "var(--muted)", border: "var(--border)", accent: "var(--muted-foreground)" },
  in_progress: { bg: "#3a2c14", border: "#ffb020", accent: "#ffb020" },
  complete:    { bg: "#13301f", border: "#5fdd9d", accent: "#5fdd9d" },
  cancelled:   { bg: "#3a1a1a", border: "#ff5b5b", accent: "#ff5b5b" },
  no_show:     { bg: "#2a1a2a", border: "#9a4a9a", accent: "#9a4a9a" },
};

export function BayTimeline({
  bookings,
  bays,
  date,
  now,
  workStart = 8,
  workEnd = 18,
  headerActions,
}: {
  bookings: BookingSlot[];
  bays: BayRow[];
  /** The day being rendered (drives the label + whether the now-line shows). */
  date: Date;
  now: Date;
  workStart?: number;
  workEnd?: number;
  /** Optional header buttons (the dashboard adds its own CTAs; the bookings
      Schedule keeps its single primary button in the page header). */
  headerActions?: ReactNode;
}) {
  const DAY_START = Math.max(0, workStart - 1);
  const DAY_END = Math.min(23, workEnd + 1);
  const DAY_SPAN = DAY_END - DAY_START;
  const PX_PER_HOUR = 90;
  const TIMELINE_W = DAY_SPAN * PX_PER_HOUR;
  const sameDay = date.toDateString() === now.toDateString();
  const nowH = now.getHours() + now.getMinutes() / 60;
  const nowPx = (nowH - DAY_START) * PX_PER_HOUR;
  const showNow = sameDay && nowH >= DAY_START && nowH <= DAY_START + DAY_SPAN;
  const hours = Array.from({ length: DAY_SPAN + 1 }, (_, i) => i + DAY_START);
  const padStart = `${String(DAY_START).padStart(2, "0")}:00`;
  const padEnd = `${String(DAY_END).padStart(2, "0")}:00`;
  const LABEL_W = 130;

  // Group bookings by bayId
  const byBay = new Map<string | null, BookingSlot[]>();
  for (const b of bookings) {
    const key = b.bayId ?? null;
    if (!byBay.has(key)) byBay.set(key, []);
    byBay.get(key)!.push(b);
  }

  type ScheduleRow = { id: string | null; name: string; sub: string | null; items: BookingSlot[] };
  const rows: ScheduleRow[] =
    bays.length > 0
      ? [
          ...bays.map((bay) => ({
            id: bay.id,
            name: bay.name,
            sub: bay.description,
            items: byBay.get(bay.id) ?? [],
          })),
          ...(byBay.has(null) && (byBay.get(null)?.length ?? 0) > 0
            ? [{ id: null, name: "Unassigned", sub: null, items: byBay.get(null) ?? [] }]
            : []),
        ]
      : [{ id: null, name: "All bookings", sub: null, items: bookings }];

  function renderBlock(b: BookingSlot, unassigned: boolean) {
    const startDate = new Date(b.scheduledAt);
    const startH = startDate.getHours() + startDate.getMinutes() / 60;
    const leftPx = Math.max(0, (startH - DAY_START) * PX_PER_HOUR);
    const widthPx = Math.max(4, (b.durationMinutes / 60) * PX_PER_HOUR);
    if (leftPx >= TIMELINE_W) return null;
    const s = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.scheduled;
    const isNarrow = widthPx < 40;

    const endDate = new Date(startDate.getTime() + b.durationMinutes * 60000);
    const fmt = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const timeRange = `${fmt(startDate)} – ${fmt(endDate)}`;
    const durStr = b.durationMinutes >= 60
      ? `${Math.floor(b.durationMinutes / 60)}h${b.durationMinutes % 60 ? ` ${b.durationMinutes % 60}m` : ""}`
      : `${b.durationMinutes}m`;
    const tooltipSide = leftPx > TIMELINE_W * 0.55 ? { right: 0 } : { left: 0 };

    return (
      <Link
        key={b.id}
        href={`/staff/bookings/${b.id}`}
        className={`booking-block absolute inset-y-1.5 overflow-visible rounded-[2px] ${isNarrow ? "p-0" : "px-1.5 py-1"}`}
        style={{
          left: leftPx,
          width: widthPx,
          background: s.bg,
          // Unassigned bookings read as "not yet placed" — dashed outline.
          border: `1px ${unassigned ? "dashed" : "solid"} ${s.border}`,
          borderLeft: `3px solid ${s.accent}`,
        }}
      >
        {!isNarrow && (
          <>
            {b.registration && (
              <div className="truncate font-mono text-[10px] font-bold leading-[1.2] tracking-[0.04em]" style={{ color: s.accent }}>
                {b.registration}
              </div>
            )}
            <div className="mt-px truncate text-[10px] leading-[1.2] text-muted-foreground">
              {b.customerName ?? b.type}
            </div>
          </>
        )}

        {/* CSS-only tooltip */}
        <div className="booking-tooltip" style={tooltipSide}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            {b.registration && (
              <span className="rounded-[2px] bg-[#f4d35e] px-1.5 py-px font-mono text-[10px] font-bold tracking-[0.06em] text-background">
                {b.registration}
              </span>
            )}
            <span
              className="ml-auto rounded-[2px] px-[5px] py-0.5 font-mono text-[9px] capitalize tracking-[0.06em]"
              style={{ background: s.bg, color: s.accent, border: `1px solid ${s.border}` }}
            >
              {b.status.replace(/_/g, " ")}
            </span>
          </div>
          {b.customerName && (
            <div className="mb-0.5 text-[13px] font-semibold text-foreground">{b.customerName}</div>
          )}
          <div className="mb-2 text-[11px] capitalize text-muted-foreground">{b.type.replace(/_/g, " ")}</div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-foreground">{timeRange}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{durStr}</span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Day schedule · {date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {padStart}–{padEnd}
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {bookings.length === 0
              ? sameDay ? "No bookings today" : "No bookings this day"
              : `${bookings.length} booking${bookings.length !== 1 ? "s" : ""} · ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
          </div>
        </div>
        {headerActions && <div className="flex flex-wrap gap-2">{headerActions}</div>}
      </div>

      {/* Schedule grid. Widths/offsets computed from the hour scale stay inline. */}
      <div className="overflow-x-auto">
        {/* Ruler */}
        <div className="flex border-b border-border" style={{ minWidth: LABEL_W + TIMELINE_W }}>
          <div
            className="sticky left-0 z-[2] shrink-0 border-r border-border bg-card px-3 py-2 font-mono text-[9px] tracking-[0.12em] text-muted-foreground"
            style={{ width: LABEL_W }}
          >
            BAY
          </div>
          <div className="relative h-[26px] shrink-0" style={{ width: TIMELINE_W }}>
            {hours.map((h) => (
              <div
                key={h}
                className="absolute top-2 -translate-x-1/2 font-mono text-[9px] text-muted-foreground"
                style={{ left: (h - DAY_START) * PX_PER_HOUR }}
              >
                {String(h).padStart(2, "0")}
              </div>
            ))}
          </div>
        </div>

        {/* Bay rows */}
        {rows.map((row, ri) => (
          <div
            key={row.id ?? "unassigned"}
            className={`flex min-h-[54px] ${ri < rows.length - 1 ? "border-b border-border" : ""}`}
            style={{ minWidth: LABEL_W + TIMELINE_W }}
          >
            <div
              className="sticky left-0 z-[1] flex shrink-0 flex-col justify-center border-r border-border bg-card px-3 py-2"
              style={{ width: LABEL_W }}
            >
              <div className="truncate font-mono text-[11px] font-semibold tracking-[0.04em] text-[#ffb020]">
                {row.name}
              </div>
              {row.sub && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">{row.sub}</div>
              )}
            </div>
            <div className="relative shrink-0 py-1.5" style={{ width: TIMELINE_W }}>
              {hours.slice(1).map((h) => (
                <div
                  key={h}
                  className="absolute inset-y-0 border-l border-dashed border-border"
                  style={{ left: (h - DAY_START) * PX_PER_HOUR }}
                />
              ))}
              {showNow && (
                <div
                  className="absolute inset-y-0 z-10 border-l border-dashed border-[#ffb020]"
                  style={{ left: nowPx }}
                />
              )}
              {row.items.map((b) => renderBlock(b, row.id === null && bays.length > 0))}
            </div>
          </div>
        ))}

        {bookings.length === 0 && (
          <div className="w-full px-[22px] py-8 text-center font-mono text-xs text-muted-foreground">
            {sameDay ? "// NO BOOKINGS TODAY" : "// NO BOOKINGS THIS DAY"}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3.5 border-t border-border px-[22px] py-3">
        {[
          { label: "Scheduled", color: "var(--muted-foreground)" },
          { label: "In progress", color: "#ffb020" },
          { label: "Complete", color: "#5fdd9d" },
          { label: "Cancelled", color: "#ff5b5b" },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-[5px]">
            <div className="h-2.5 w-2.5 rounded-[1px]" style={{ background: l.color }} />
            <span className="font-mono text-[9px] text-muted-foreground">{l.label}</span>
          </div>
        ))}
        {showNow && (
          <div className="flex items-center gap-[5px]">
            <div className="w-3.5 border-t border-dashed border-[#ffb020]" />
            <span className="font-mono text-[9px] text-muted-foreground">Now</span>
          </div>
        )}
      </div>
    </div>
  );
}
