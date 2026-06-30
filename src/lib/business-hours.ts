// Per-day opening hours for a branch, plus one-off date overrides. Stored on
// locations.business_hours (jsonb, weekday → {open,close} in minutes from
// midnight; an absent weekday = closed) and location_special_hours (dated
// overrides). Shared by the staff settings editor, the public booking widget,
// the AI receptionist, the bookings calendar and reports so "are we open then,
// and what hours?" is answered the same everywhere.

// UK garages run on UK time; weekday-from-instant uses this zone (matches the
// bookings calendar).
export const APP_TZ = "Europe/London";

// Monday-first display order (UK convention), Sunday last.
export const WEEKDAY_ORDER: number[] = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_FULL: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

export const WEEKDAY_SHORT: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

const SHORT_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Minutes from midnight.
export type DayHours = { open: number; close: number };
// Weekday (0=Sun..6=Sat) → that day's hours. Missing key = closed.
export type WeeklyHours = Record<number, DayHours>;
// A one-off dated override (closed, or custom hours), keyed by "YYYY-MM-DD".
export type SpecialHours = {
  date: string;
  isClosed: boolean;
  openMinute: number | null;
  closeMinute: number | null;
};

export const MIN_PER_DAY = 24 * 60;

// Mon–Sat 08:00–18:00 — the default week for a new/un-set branch.
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  1: { open: 480, close: 1080 },
  2: { open: 480, close: 1080 },
  3: { open: 480, close: 1080 },
  4: { open: 480, close: 1080 },
  5: { open: 480, close: 1080 },
  6: { open: 480, close: 1080 },
};

function validDay(h: unknown): h is DayHours {
  if (!h || typeof h !== "object") return false;
  const { open, close } = h as Record<string, unknown>;
  return (
    Number.isInteger(open) &&
    Number.isInteger(close) &&
    (open as number) >= 0 &&
    (close as number) <= MIN_PER_DAY &&
    (open as number) < (close as number)
  );
}

// Coerce the raw jsonb (string-keyed, untrusted) into a clean WeeklyHours.
// Invalid weekdays/ranges are dropped. An empty/garbage value falls back to the
// default week so a branch is never left with no hours.
export function parseWeeklyHours(raw: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const wd = Number(k);
      if (Number.isInteger(wd) && wd >= 0 && wd <= 6 && validDay(v)) {
        out[wd] = { open: (v as DayHours).open, close: (v as DayHours).close };
      }
    }
  }
  return Object.keys(out).length === 0 ? { ...DEFAULT_WEEKLY_HOURS } : out;
}

// Weekday (0–6) of a naive local date string ("YYYY-MM-DD" or with a time).
// Built from explicit calendar parts so it's the intended calendar weekday
// regardless of the runtime timezone.
export function weekdayOfLocalDate(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1).getDay();
}

// Weekday (0–6) of an absolute instant (ISO string), evaluated in the garage's
// timezone — so a 23:30Z summer slot lands on the correct UK calendar day.
export function weekdayOfInstant(iso: string, tz: string = APP_TZ): number {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(iso));
  return SHORT_TO_NUM[label] ?? new Date(iso).getDay();
}

export type ResolvedHours = { open: boolean; hours: DayHours | null };

// THE source of truth for "is the branch open on this date, and what hours?".
// A special-hours row for the date wins (closed, or its custom hours); else the
// weekday's regular hours; else closed.
export function resolveHoursForDate(
  weekly: WeeklyHours,
  exceptions: SpecialHours[],
  dateStr: string,
): ResolvedHours {
  const key = dateStr.slice(0, 10);
  const ex = exceptions.find((e) => e.date.slice(0, 10) === key);
  if (ex) {
    if (ex.isClosed) return { open: false, hours: null };
    if (
      Number.isInteger(ex.openMinute) &&
      Number.isInteger(ex.closeMinute) &&
      (ex.openMinute as number) < (ex.closeMinute as number)
    ) {
      return { open: true, hours: { open: ex.openMinute!, close: ex.closeMinute! } };
    }
    return { open: false, hours: null }; // malformed custom → safest is closed
  }
  const h = weekly[weekdayOfLocalDate(key)];
  return h ? { open: true, hours: h } : { open: false, hours: null };
}

// 30-minute time options for the settings dropdowns: { value: minutes, label }.
export const HALF_HOUR_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: MIN_PER_DAY / 30 },
  (_, i) => ({ value: i * 30, label: minutesToLabel(i * 30) }),
);

// 510 → "08:30". Clamped 0–1439.
export function minutesToLabel(min: number): string {
  const m = Math.max(0, Math.min(MIN_PER_DAY - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// A single day's hours as text: "08:30–12:30".
export function formatDayHours(h: DayHours): string {
  return `${minutesToLabel(h.open)}–${minutesToLabel(h.close)}`;
}

const sameDay = (a: DayHours | undefined, b: DayHours | undefined): boolean =>
  (!a && !b) || (!!a && !!b && a.open === b.open && a.close === b.close);

// Grouped weekly summary, Monday-first: consecutive days that share a state are
// merged — e.g. "Mon–Fri 08:00–18:00, Sat 08:30–12:30, Sun closed".
export function formatWeeklySummary(weekly: WeeklyHours): string {
  const groups: { days: number[]; hours: DayHours | undefined }[] = [];
  for (const wd of WEEKDAY_ORDER) {
    const h = weekly[wd];
    const last = groups[groups.length - 1];
    if (last && sameDay(last.hours, h)) last.days.push(wd);
    else groups.push({ days: [wd], hours: h });
  }
  return groups
    .map((g) => {
      const span =
        g.days.length === 1
          ? WEEKDAY_SHORT[g.days[0]]
          : `${WEEKDAY_SHORT[g.days[0]]}–${WEEKDAY_SHORT[g.days[g.days.length - 1]]}`;
      return g.hours ? `${span} ${formatDayHours(g.hours)}` : `${span} closed`;
    })
    .join(", ");
}
