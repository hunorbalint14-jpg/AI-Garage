"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type BookingRow,
  STATUS_STYLE,
  STATUS_DOT,
  statusLabel,
  typeLabel,
} from "./booking-display";
import {
  parseMonthParam,
  buildMonthGrid,
  addMonths,
  toMonthParam,
  dayKey,
  instantDayKey,
  instantTimeLabel,
  formatMonthLabel,
} from "./calendar-grid";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fullDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function BookingCalendar({
  bookings,
  monthParam,
  todayKey,
  businessDays,
}: {
  bookings: BookingRow[];
  monthParam: string;
  todayKey: string;
  /** Open weekdays as JS getDay() numbers (0=Sun..6=Sat). */
  businessDays: number[];
}) {
  const router = useRouter();
  const { year, month } = parseMonthParam(monthParam);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  // Bucket bookings into local-day cells, each sorted by time.
  const byDay = useMemo(() => {
    const map = new Map<string, BookingRow[]>();
    for (const b of bookings) {
      const key = instantDayKey(b.scheduled_at);
      const list = map.get(key);
      if (list) list.push(b);
      else map.set(key, [b]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
    }
    return map;
  }, [bookings]);

  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const [selected, setSelected] = useState<string>(() =>
    todayKey.startsWith(monthPrefix) ? todayKey : `${monthPrefix}-01`,
  );

  function navMonth(delta: number) {
    const { year: y, month: m } = addMonths(year, month, delta);
    router.push(`/staff/bookings?view=calendar&month=${toMonthParam(y, m)}`);
  }

  const selectedBookings = byDay.get(selected) ?? [];
  const selectedClosed = (() => {
    const [y, m, d] = selected.split("-").map(Number);
    return !businessDays.includes(new Date(y, m - 1, d).getDay());
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {/* Calendar */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{formatMonthLabel(year, month)}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => navMonth(-1)}
              aria-label="Previous month"
              className="rounded-md p-2 hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() =>
                router.push(
                  `/staff/bookings?view=calendar&month=${todayKey.slice(0, 7)}`,
                )
              }
              className="rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => navMonth(1)}
              aria-label="Next month"
              className="rounded-md p-2 hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              <span className="sm:hidden">{d[0]}</span>
              <span className="hidden sm:inline">{d}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {grid.map((date) => {
            const key = dayKey(date);
            const inMonth = date.getMonth() === month;
            const dayBookings = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            const isSelected = key === selected;
            const isClosed = !businessDays.includes(date.getDay());
            return (
              <button
                type="button"
                key={key}
                onClick={() => setSelected(key)}
                title={isClosed ? "Closed" : undefined}
                className={cn(
                  "flex min-h-[58px] flex-col items-start gap-1 border-b border-r p-1 text-left transition-colors sm:min-h-[76px] sm:p-1.5",
                  "hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/40",
                  !inMonth && "bg-muted/20 text-muted-foreground",
                  isClosed && inMonth && "bg-muted/40 text-muted-foreground",
                  isSelected && "bg-primary/10 ring-1 ring-inset ring-primary",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    isToday && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {date.getDate()}
                </span>
                {isClosed && dayBookings.length === 0 && (
                  <span className="text-[10px] leading-none text-muted-foreground">Closed</span>
                )}
                {dayBookings.length > 0 && (
                  <span className="flex flex-wrap items-center gap-1">
                    {dayBookings.slice(0, 3).map((b) => (
                      <span
                        key={b.id}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          STATUS_DOT[b.status] ?? "bg-foreground/40",
                        )}
                      />
                    ))}
                    {dayBookings.length > 3 && (
                      <span className="text-[10px] leading-none text-muted-foreground">
                        +{dayBookings.length - 3}
                      </span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day panel */}
      <div className="rounded-lg border lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{fullDayLabel(selected)}</h2>
          {selectedClosed ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Closed
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {selectedBookings.length} booking{selectedBookings.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="flex flex-col">
          {selectedBookings.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              No bookings on this day.
            </p>
          ) : (
            selectedBookings.map((b) => (
              <Link
                key={b.id}
                href={`/staff/bookings/${b.id}`}
                className="flex flex-col gap-1 border-b px-4 py-3 last:border-b-0 hover:bg-muted/50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{instantTimeLabel(b.scheduled_at)}</span>
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                      STATUS_STYLE[b.status] ?? "",
                    )}
                  >
                    {statusLabel(b.status)}
                  </span>
                </div>
                <div className="text-sm">
                  {typeLabel(b.type)}
                  {b.vehicle?.registration && (
                    <span className="ml-2 font-mono text-muted-foreground">
                      {b.vehicle.registration}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {b.customer?.full_name ?? "Unknown customer"} · {b.duration_minutes} min
                </div>
              </Link>
            ))
          )}
        </div>

        <div className="border-t p-3">
          <Link
            href={`/staff/bookings/new?date=${selected}`}
            className="flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <CalendarPlus className="h-4 w-4" />
            New booking
          </Link>
        </div>
      </div>
    </div>
  );
}
