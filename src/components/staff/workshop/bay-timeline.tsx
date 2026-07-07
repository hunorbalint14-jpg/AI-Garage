"use client";

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { moveBooking } from "@/app/staff/bookings/actions";
import type { BayRow, BookingSlot } from "@/lib/dashboard";

// Shared bay timeline (UX review §1d): promoted from the dashboard's
// TodaySchedule so the dashboard and the bookings Schedule render the SAME
// component — one file owns the block styles and status colours. Now a client
// component: scheduled blocks drag to reschedule (time + bay) and resize from
// the right edge to change duration (#491), with optimistic updates + undo.

const BOOKING_STATUS: Record<string, { bg: string; border: string; accent: string }> = {
  scheduled:   { bg: "var(--muted)", border: "var(--border)", accent: "var(--muted-foreground)" },
  in_progress: { bg: "#3a2c14", border: "#ffb020", accent: "#ffb020" },
  complete:    { bg: "#13301f", border: "#5fdd9d", accent: "#5fdd9d" },
  cancelled:   { bg: "#3a1a1a", border: "#ff5b5b", accent: "#ff5b5b" },
  no_show:     { bg: "#2a1a2a", border: "#9a4a9a", accent: "#9a4a9a" },
};

const PX_PER_HOUR = 90;
const SNAP_MIN = 15;
const SNAP_PX = (PX_PER_HOUR * SNAP_MIN) / 60; // 22.5px per 15-min step
const LABEL_W = 130;
const DRAG_THRESHOLD_PX = 5;

type Override = { scheduledAt: string; bayId: string | null; durationMinutes: number };

type DragState = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
  fromRow: number;
  targetRow: number;
};

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function naiveLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function BayTimeline({
  bookings,
  bays,
  date,
  now,
  workStart = 8,
  workEnd = 18,
  headerActions,
  interactive = false,
}: {
  bookings: BookingSlot[];
  bays: BayRow[];
  /** ISO date of the day being rendered (label + now-line eligibility). */
  date: string;
  /** ISO instant used for the now line. */
  now: string;
  workStart?: number;
  workEnd?: number;
  /** Optional header buttons (the dashboard adds its own CTAs; the bookings
      Schedule keeps its single primary button in the page header). */
  headerActions?: ReactNode;
  /** Enable drag-to-reschedule / resize on scheduled blocks. */
  interactive?: boolean;
}) {
  const router = useRouter();
  const dateObj = useMemo(() => new Date(date), [date]);
  const nowObj = useMemo(() => new Date(now), [now]);

  const DAY_START = Math.max(0, workStart - 1);
  const DAY_END = Math.min(23, workEnd + 1);
  const DAY_SPAN = DAY_END - DAY_START;
  const TIMELINE_W = DAY_SPAN * PX_PER_HOUR;
  const sameDay = dateObj.toDateString() === nowObj.toDateString();
  const nowH = nowObj.getHours() + nowObj.getMinutes() / 60;
  const nowPx = (nowH - DAY_START) * PX_PER_HOUR;
  const showNow = sameDay && nowH >= DAY_START && nowH <= DAY_START + DAY_SPAN;
  const hours = Array.from({ length: DAY_SPAN + 1 }, (_, i) => i + DAY_START);
  const padStart = `${String(DAY_START).padStart(2, "0")}:00`;
  const padEnd = `${String(DAY_END).padStart(2, "0")}:00`;

  // Optimistic layer: server truth (props) + local overrides from drags.
  // Fresh props (post-refresh) clear the overrides — the adjust-state-during-
  // render pattern, so no effect fires an extra pass.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [prevBookings, setPrevBookings] = useState(bookings);
  if (prevBookings !== bookings) {
    setPrevBookings(bookings);
    setOverrides({});
  }
  const [drag, setDrag] = useState<DragState | null>(null);
  const [, startSaving] = useTransition();
  const [snack, setSnack] = useState<{ text: string; undo?: Override & { id: string } } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowsRef = useRef<(HTMLDivElement | null)[]>([]);

  function showSnack(next: { text: string; undo?: Override & { id: string } }) {
    if (snackTimer.current) clearTimeout(snackTimer.current);
    setSnack(next);
    snackTimer.current = setTimeout(() => setSnack(null), 6000);
  }

  const effective = useMemo(
    () =>
      bookings.map((b) => {
        const o = overrides[b.id];
        return o
          ? { ...b, scheduledAt: o.scheduledAt, bayId: o.bayId, durationMinutes: o.durationMinutes }
          : b;
      }),
    [bookings, overrides],
  );

  // Group bookings by bayId
  const byBay = new Map<string | null, BookingSlot[]>();
  for (const b of effective) {
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
          // Keep an Unassigned lane whenever it has items OR a drag is live,
          // so a block can be dragged out of its bay.
          ...((byBay.get(null)?.length ?? 0) > 0 || (interactive && drag)
            ? [{ id: null, name: "Unassigned", sub: null, items: byBay.get(null) ?? [] }]
            : []),
        ]
      : [{ id: null, name: "All bookings", sub: null, items: effective }];

  // ── drag machinery ───────────────────────────────────────────────────────
  function applyDrop(b: BookingSlot, d: DragState) {
    const steps = Math.round(d.dx / SNAP_PX);
    const prev: Override & { id: string } = {
      id: b.id,
      scheduledAt: b.scheduledAt,
      bayId: b.bayId ?? null,
      durationMinutes: b.durationMinutes,
    };

    let next: Override;
    let payload: Parameters<typeof moveBooking>[0];
    let label: string;
    if (d.mode === "resize") {
      const duration = Math.max(SNAP_MIN, b.durationMinutes + steps * SNAP_MIN);
      if (duration === b.durationMinutes) return;
      next = { scheduledAt: b.scheduledAt, bayId: b.bayId ?? null, durationMinutes: duration };
      payload = { bookingId: b.id, durationMinutes: duration };
      label = `Duration → ${duration}m`;
    } else {
      const newStart = new Date(new Date(b.scheduledAt).getTime() + steps * SNAP_MIN * 60_000);
      const targetRowDef = rows[d.targetRow];
      const newBay = targetRowDef ? targetRowDef.id : (b.bayId ?? null);
      const timeChanged = steps !== 0;
      const bayChanged = newBay !== (b.bayId ?? null);
      if (!timeChanged && !bayChanged) return;
      next = { scheduledAt: newStart.toISOString(), bayId: newBay, durationMinutes: b.durationMinutes };
      payload = {
        bookingId: b.id,
        ...(timeChanged ? { scheduledAt: naiveLocal(newStart) } : {}),
        ...(bayChanged ? { bayId: newBay } : {}),
      };
      label = `Moved to ${fmtTime(newStart)}${bayChanged && targetRowDef ? ` · ${targetRowDef.name}` : ""}`;
    }

    setOverrides((o) => ({ ...o, [b.id]: next }));
    startSaving(async () => {
      const result = await moveBooking(payload);
      if ("error" in result) {
        setOverrides((o) => ({ ...o, [b.id]: prev }));
        showSnack({ text: result.error });
      } else {
        showSnack({ text: label, undo: prev });
        router.refresh();
      }
    });
  }

  function undoMove(prev: Override & { id: string }) {
    setSnack(null);
    setOverrides((o) => ({ ...o, [prev.id]: prev }));
    startSaving(async () => {
      const result = await moveBooking({
        bookingId: prev.id,
        scheduledAt: naiveLocal(new Date(prev.scheduledAt)),
        bayId: prev.bayId,
        durationMinutes: prev.durationMinutes,
      });
      if ("error" in result) showSnack({ text: result.error });
      else router.refresh();
    });
  }

  function startDrag(e: React.PointerEvent, b: BookingSlot, rowIndex: number, mode: "move" | "resize") {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: b.id, mode, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false, fromRow: rowIndex, targetRow: rowIndex });
  }

  function onPointerMove(e: React.PointerEvent) {
    setDrag((d) => {
      if (!d) return d;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      let targetRow = d.targetRow;
      if (d.mode === "move") {
        rowsRef.current.forEach((el, i) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          if (e.clientY >= r.top && e.clientY < r.bottom) targetRow = i;
        });
      }
      return {
        ...d,
        dx,
        dy,
        targetRow,
        moved: d.moved || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX,
      };
    });
  }

  function onPointerUp(b: BookingSlot) {
    if (!drag || drag.id !== b.id) return;
    const d = drag;
    setDrag(null);
    if (d.moved) applyDrop(b, d);
    else router.push(`/staff/bookings/${b.id}`);
  }

  function renderBlock(b: BookingSlot, rowIndex: number, unassignedLane: boolean) {
    const startDate = new Date(b.scheduledAt);
    const startH = startDate.getHours() + startDate.getMinutes() / 60;
    const baseLeft = Math.max(0, (startH - DAY_START) * PX_PER_HOUR);
    const baseWidth = Math.max(4, (b.durationMinutes / 60) * PX_PER_HOUR);
    if (baseLeft >= TIMELINE_W) return null;
    const s = BOOKING_STATUS[b.status] ?? BOOKING_STATUS.scheduled;

    const isThisDrag = drag?.id === b.id;
    const isDragging = !!(isThisDrag && drag!.moved);
    const snappedDx = isDragging ? Math.round(drag!.dx / SNAP_PX) * SNAP_PX : 0;
    const leftPx = isDragging && drag!.mode === "move" ? Math.max(0, baseLeft + snappedDx) : baseLeft;
    const widthPx = isDragging && drag!.mode === "resize" ? Math.max(SNAP_PX, baseWidth + snappedDx) : baseWidth;
    const laneShift = isDragging && drag!.mode === "move" ? drag!.dy : 0;
    const isNarrow = widthPx < 40;

    const endDate = new Date(startDate.getTime() + b.durationMinutes * 60000);
    const timeRange = `${fmtTime(startDate)} – ${fmtTime(endDate)}`;
    const durStr = b.durationMinutes >= 60
      ? `${Math.floor(b.durationMinutes / 60)}h${b.durationMinutes % 60 ? ` ${b.durationMinutes % 60}m` : ""}`
      : `${b.durationMinutes}m`;
    const tooltipSide = baseLeft > TIMELINE_W * 0.55 ? { right: 0 } : { left: 0 };
    const canDrag = interactive && b.status === "scheduled";
    const canResize = interactive && (b.status === "scheduled" || b.status === "in_progress");

    return (
      <div
        key={b.id}
        role="link"
        tabIndex={0}
        aria-label={`Booking ${b.registration ?? b.type} at ${fmtTime(startDate)}`}
        onPointerDown={canDrag ? (e) => startDrag(e, b, rowIndex, "move") : undefined}
        onPointerMove={isThisDrag ? onPointerMove : undefined}
        onPointerUp={isThisDrag ? () => onPointerUp(b) : undefined}
        onClick={!canDrag ? () => router.push(`/staff/bookings/${b.id}`) : undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(`/staff/bookings/${b.id}`);
        }}
        className={`booking-block absolute inset-y-1.5 overflow-visible rounded-[2px] ${isNarrow ? "p-0" : "px-1.5 py-1"} ${
          canDrag ? "cursor-grab touch-none" : "cursor-pointer"
        } ${isDragging ? "z-30 opacity-90 shadow-lg" : ""}`}
        style={{
          left: leftPx,
          width: widthPx,
          transform: laneShift ? `translateY(${laneShift}px)` : undefined,
          background: s.bg,
          // Unassigned bookings read as "not yet placed" — dashed outline.
          border: `1px ${unassignedLane ? "dashed" : "solid"} ${s.border}`,
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

        {/* Right-edge resize handle */}
        {canResize && (
          <div
            onPointerDown={(e) => startDrag(e, b, rowIndex, "resize")}
            onPointerMove={isThisDrag ? onPointerMove : undefined}
            onPointerUp={isThisDrag ? () => onPointerUp(b) : undefined}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize touch-none"
            aria-hidden
          />
        )}

        {/* CSS-only tooltip (suppressed mid-drag) */}
        {!isDragging && (
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
        )}
      </div>
    );
  }

  return (
    <div className="relative rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Day schedule · {dateObj.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · {padStart}–{padEnd}
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {effective.length === 0
              ? sameDay ? "No bookings today" : "No bookings this day"
              : `${effective.length} booking${effective.length !== 1 ? "s" : ""} · ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
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
            ref={(el) => {
              rowsRef.current[ri] = el;
            }}
            className={`flex min-h-[54px] ${ri < rows.length - 1 ? "border-b border-border" : ""} ${
              drag?.moved && drag.mode === "move" && drag.targetRow === ri && drag.fromRow !== ri
                ? "bg-[#1c1810]"
                : ""
            }`}
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
              {row.items.map((b) => renderBlock(b, ri, row.id === null && bays.length > 0))}
            </div>
          </div>
        ))}

        {effective.length === 0 && (
          <div className="w-full px-[22px] py-8 text-center font-mono text-xs text-muted-foreground">
            {sameDay ? "// NO BOOKINGS TODAY" : "// NO BOOKINGS THIS DAY"}
          </div>
        )}
      </div>

      {/* Legend + drag hint */}
      <div className="flex flex-wrap items-center gap-3.5 border-t border-border px-[22px] py-3">
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
        {interactive && (
          <span className="ml-auto font-mono text-[9px] text-muted-foreground">
            {"// DRAG A BLOCK TO RESCHEDULE · DRAG THE EDGE TO RESIZE"}
          </span>
        )}
      </div>

      {/* Undo snackbar */}
      {snack && (
        <div className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-[4px] border border-[#3a4049] bg-[#1c2026] px-3.5 py-2 shadow-xl">
          <span className="whitespace-nowrap font-mono text-[11px] text-[#e6e8eb]">{snack.text}</span>
          {snack.undo && (
            <button
              type="button"
              onClick={() => undoMove(snack.undo!)}
              className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-[#ffb020] hover:underline"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
