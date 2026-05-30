// Pure date helpers for the bookings month calendar. No React, no I/O — kept
// separate so the grid maths is unit-testable. Week starts Monday (UK).

export type MonthParts = { year: number; month: number }; // month: 0-11

// Parse a `YYYY-MM` URL param into { year, month }. Falls back to the current
// month on missing/garbage input.
export function parseMonthParam(s?: string | null, now = new Date()): MonthParts {
  const m = /^(\d{4})-(\d{2})$/.exec(s ?? "");
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (month >= 0 && month <= 11) return { year, month };
  }
  return { year: now.getFullYear(), month: now.getMonth() };
}

export function toMonthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// Shift a month by `delta`, wrapping the year. Uses Date so Dec→Jan etc. is
// handled for us.
export function addMonths(year: number, month: number, delta: number): MonthParts {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// 42 dates (6 weeks) covering `month`, Monday-first, with leading/trailing days
// from the adjacent months so the grid is always a full rectangle.
export function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // JS getDay(): 0=Sun..6=Sat. Convert to Monday-first offset (Mon=0..Sun=6).
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

// `YYYY-MM-DD` for a Date built from local calendar parts (the grid cells).
// Cells are constructed via `new Date(year, month, day)`, so the components are
// exactly those values regardless of runtime timezone — SSR-stable.
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// UK garages run on UK time. Bucket bookings (stored UTC) by their Europe/London
// calendar day so a 23:30Z booking in summer lands on the next day's cell — and
// so the result is identical on the server (UTC) and the client (browser tz),
// avoiding a hydration mismatch.
export const APP_TZ = "Europe/London";

export function instantDayKey(iso: string, tz: string = APP_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function instantTimeLabel(iso: string, tz: string = APP_TZ): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}
