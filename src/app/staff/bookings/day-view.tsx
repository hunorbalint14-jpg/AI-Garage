import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { STATUS_STYLE, statusLabel, typeLabel, type BookingRow } from "./booking-display";
import { resolveHoursForDate, formatDayHours, type WeeklyHours, type SpecialHours } from "@/lib/business-hours";

type Bay = { id: string; name: string; description: string | null };
type DayBooking = BookingRow & { bay_id: string | null; technicianName: string | null };

// Single-day schedule grouped by bay. A busy workshop runs day-by-day; the
// month grid answers "when is X booked?" but not "what's happening today and
// which bay is free?". Server-rendered — navigation is via date links.
export function DayView({
  date,
  bookings,
  bays,
  baseHref,
  weekly,
  specialHours,
}: {
  /** YYYY-MM-DD for the day being shown */
  date: string;
  bookings: DayBooking[];
  bays: Bay[];
  baseHref: string;
  weekly: WeeklyHours;
  specialHours: SpecialHours[];
}) {
  const day = new Date(`${date}T00:00:00`);
  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const todayStr = toDateParam(new Date());
  const isToday = date === todayStr;
  const resolved = resolveHoursForDate(weekly, specialHours, date);
  const isClosed = !resolved.open;

  const byBay = new Map<string | null, DayBooking[]>();
  for (const b of bookings) {
    const key = b.bay_id ?? null;
    if (!byBay.has(key)) byBay.set(key, []);
    byBay.get(key)!.push(b);
  }

  const sections: { id: string | null; name: string; sub: string | null; items: DayBooking[] }[] =
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

  return (
    <div className="flex flex-col gap-4">
      {/* Date navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          {day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          {isToday && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Today</span>}
          {isClosed ? (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">Closed</span>
          ) : (
            resolved.hours && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{formatDayHours(resolved.hours)}</span>
            )
          )}
        </h2>
        <div className="flex items-center gap-2">
          <Link
            href={`${baseHref}&date=${prev}`}
            className="grid h-8 w-8 place-items-center rounded-md border hover:bg-muted"
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          {!isToday && (
            <Link
              href={`${baseHref}&date=${todayStr}`}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Today
            </Link>
          )}
          <Link
            href={`${baseHref}&date=${next}`}
            className="grid h-8 w-8 place-items-center rounded-md border hover:bg-muted"
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {isClosed && (
        <div className="rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          The branch is normally closed on this day. New online bookings are blocked, but staff can still add one manually.
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No bookings on this day.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((section) => (
            <section key={section.id ?? "none"} className="rounded-lg border">
              <header className="flex items-baseline gap-2 border-b bg-muted/30 px-4 py-2">
                <h3 className="text-sm font-semibold">{section.name}</h3>
                {section.sub && <span className="text-xs text-muted-foreground">{section.sub}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {section.items.length} booking{section.items.length !== 1 ? "s" : ""}
                </span>
              </header>
              {section.items.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Free all day.</p>
              ) : (
                <ul className="divide-y">
                  {section.items.map((b) => (
                    <li key={b.id}>
                      <Link
                        href={`/staff/bookings/${b.id}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 transition-colors hover:bg-muted/40"
                      >
                        <span className="w-24 shrink-0 font-mono text-sm font-medium">
                          {timeRange(b.scheduled_at, b.duration_minutes)}
                        </span>
                        <span className="text-sm font-medium">{b.customer?.full_name ?? "—"}</span>
                        {b.vehicle?.registration && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">
                            {b.vehicle.registration}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {typeLabel(b.type)}
                          {b.technicianName ? ` · ${b.technicianName}` : ""}
                        </span>
                        <span
                          className={`ml-auto inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_STYLE[b.status] ?? ""
                          }`}
                        >
                          {statusLabel(b.status)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function timeRange(iso: string, durationMinutes: number): string {
  const start = new Date(iso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const fmt = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${fmt(start)}–${fmt(end)}`;
}

function toDateParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateParam(d);
}
