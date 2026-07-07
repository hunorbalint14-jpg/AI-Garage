"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { getAvailableSlotsWeek } from "@/lib/slots-actions";
import { addDays, type SlotDay } from "@/lib/slots";
import { WEEKDAY_FULL, WEEKDAY_SHORT, weekdayOfLocalDate, APP_TZ } from "@/lib/business-hours";

// Customer-facing slot picker (UX review F13): 7-day strip + 30-min slot grid,
// brand-coloured, themable for the light /book widget and the dark customer
// portal. NOT workshop-styled — this renders in front of customers.
//
// value/onChange speak the same naive "YYYY-MM-DDTHH:mm" wall-time strings the
// existing booking flows submit as scheduledAt.

type Theme = "light" | "dark";

const THEME = {
  light: {
    dayIdle: "border-gray-200 bg-white text-gray-900 hover:border-gray-400",
    dayClosed: "border-gray-200 bg-gray-50 text-gray-300",
    dayLabel: "text-gray-400",
    slotIdle: "border-gray-200 bg-white text-gray-900 hover:border-gray-400",
    slotTaken: "border-gray-100 bg-gray-50 text-gray-300 line-through",
    helper: "text-gray-500",
    skeleton: "bg-gray-100",
  },
  dark: {
    dayIdle: "border-white/15 bg-white/[0.03] text-white hover:border-white/40",
    dayClosed: "border-white/10 bg-transparent text-white/25",
    dayLabel: "text-white/40",
    slotIdle: "border-white/15 bg-white/[0.03] text-white hover:border-white/40",
    slotTaken: "border-white/5 bg-transparent text-white/25 line-through",
    helper: "text-white/50",
    skeleton: "bg-white/5",
  },
} satisfies Record<Theme, Record<string, string>>;

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

export function SlotPicker({
  locationId,
  durationMinutes,
  value,
  onChange,
  theme,
  primaryColor,
  initialWeek,
}: {
  locationId: string;
  durationMinutes: number;
  value: string | null;
  onChange: (value: string) => void;
  theme: Theme;
  /** Org brand colour for selected states. */
  primaryColor: string;
  /** Optional pre-fetched week (SSR or fixtures); skips the initial fetch. */
  initialWeek?: SlotDay[];
}) {
  const t = THEME[theme];
  const [weekStart, setWeekStart] = useState(() => initialWeek?.[0]?.date ?? todayKey());
  const [week, setWeek] = useState<SlotDay[] | null>(initialWeek ?? null);
  const [selectedDate, setSelectedDate] = useState<string | null>(
    value ? value.slice(0, 10) : null,
  );
  const [loading, startLoading] = useTransition();

  // Fetch whenever the visible week changes (skipped when initialWeek already
  // covers the current weekStart).
  useEffect(() => {
    if (week?.[0]?.date === weekStart) return;
    startLoading(async () => {
      const days = await getAvailableSlotsWeek(locationId, weekStart, durationMinutes);
      setWeek(days);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, locationId, durationMinutes]);

  const days = useMemo(() => week ?? [], [week]);
  const activeDay = useMemo(() => {
    if (selectedDate) {
      const hit = days.find((d) => d.date === selectedDate);
      if (hit) return hit;
    }
    return days.find((d) => d.open && d.slots.some((s) => s.available)) ?? days[0] ?? null;
  }, [days, selectedDate]);

  const closedNames = useMemo(() => {
    const names = days
      .filter((d) => !d.open)
      .map((d) => WEEKDAY_FULL[weekdayOfLocalDate(d.date)]);
    return [...new Set(names)];
  }, [days]);

  const atToday = weekStart <= todayKey();

  return (
    <div className="flex flex-col gap-3">
      {/* Week nav + day strip */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Earlier week"
          disabled={atToday || loading}
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          className={`flex h-11 w-8 shrink-0 items-center justify-center rounded-lg border text-sm ${t.slotIdle} disabled:cursor-not-allowed disabled:opacity-30`}
        >
          ‹
        </button>
        <div className="grid min-w-0 flex-1 grid-cols-7 gap-1.5">
          {days.length === 0
            ? Array.from({ length: 7 }, (_, i) => (
                <div key={i} className={`h-14 animate-pulse rounded-lg ${t.skeleton}`} />
              ))
            : days.map((d) => {
                const wd = weekdayOfLocalDate(d.date);
                const selected = activeDay?.date === d.date;
                const closed = !d.open;
                return (
                  <button
                    key={d.date}
                    type="button"
                    disabled={closed}
                    onClick={() => setSelectedDate(d.date)}
                    aria-pressed={selected}
                    aria-label={`${WEEKDAY_FULL[wd]} ${d.date}${closed ? " — closed" : ""}`}
                    className={`flex h-14 min-w-0 flex-col items-center justify-center rounded-lg border transition-colors ${
                      closed ? `${t.dayClosed} cursor-not-allowed` : t.dayIdle
                    }`}
                    style={selected ? { borderColor: primaryColor, borderWidth: 2 } : undefined}
                  >
                    <span className={`font-mono text-[9px] uppercase tracking-wide ${closed ? "" : t.dayLabel}`}>
                      {WEEKDAY_SHORT[wd]}
                    </span>
                    <span className="text-sm font-semibold">
                      {closed ? "✕" : Number(d.date.slice(8, 10))}
                    </span>
                  </button>
                );
              })}
        </div>
        <button
          type="button"
          aria-label="Later week"
          disabled={loading}
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          className={`flex h-11 w-8 shrink-0 items-center justify-center rounded-lg border text-sm ${t.slotIdle} disabled:cursor-not-allowed disabled:opacity-30`}
        >
          ›
        </button>
      </div>

      {/* Slot grid for the active day */}
      {loading && !week ? null : activeDay && activeDay.open ? (
        activeDay.slots.length > 0 ? (
          <div className={`grid grid-cols-4 gap-1.5 ${loading ? "opacity-50" : ""}`}>
            {activeDay.slots.map((s) => {
              const slotValue = `${activeDay.date}T${s.time}`;
              const selected = value === slotValue;
              return (
                <button
                  key={s.time}
                  type="button"
                  disabled={!s.available}
                  onClick={() => onChange(slotValue)}
                  aria-pressed={selected}
                  className={`h-11 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                    s.available ? t.slotIdle : t.slotTaken
                  }`}
                  style={
                    selected
                      ? { backgroundColor: primaryColor, borderColor: primaryColor, color: "#fff" }
                      : undefined
                  }
                >
                  {s.time}
                </button>
              );
            })}
          </div>
        ) : (
          <p className={`text-sm ${t.helper}`}>No times left that day — try another day.</p>
        )
      ) : activeDay ? (
        <p className={`text-sm ${t.helper}`}>We&apos;re closed that day.</p>
      ) : null}

      {/* Helper line */}
      {days.length > 0 && (
        <p className={`text-xs ${t.helper}`}>
          Crossed-out times are already booked.
          {closedNames.length > 0 && closedNames.length < 7
            ? ` ${closedNames.join(" and ")} we're closed.`
            : ""}
        </p>
      )}
    </div>
  );
}
