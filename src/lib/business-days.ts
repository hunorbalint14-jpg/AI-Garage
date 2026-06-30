// Operational/opening days for a branch. Stored on locations.business_days as
// JS getDay() weekday numbers: 0=Sun, 1=Mon … 6=Sat. Shared by the staff
// settings editor, the public booking widget, the AI receptionist and the
// bookings calendar so "are we open that day?" is answered the same everywhere.

// UK garages run on UK time; weekday-from-instant uses this zone (matches the
// bookings calendar's APP_TZ).
export const APP_TZ = "Europe/London";

// Mon–Sat — the default for new/existing branches (see the migration).
export const DEFAULT_BUSINESS_DAYS: number[] = [1, 2, 3, 4, 5, 6];

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

// Valid weekday numbers from arbitrary input, de-duplicated and ordered
// Monday-first. May return an empty list (see normalizeBusinessDays for the
// defaulting variant).
function sanitizeDays(input: unknown): number[] {
  const arr = Array.isArray(input) ? input : [];
  const set = new Set<number>();
  for (const v of arr) {
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return WEEKDAY_ORDER.filter((d) => set.has(d));
}

// Coerce arbitrary input (form values, DB rows) into a clean, sorted list of
// open days. Empty/garbage input falls back to the default week so a branch is
// never left with no days.
export function normalizeBusinessDays(input: unknown): number[] {
  const days = sanitizeDays(input);
  return days.length === 0 ? [...DEFAULT_BUSINESS_DAYS] : days;
}

export function isOpenOn(businessDays: number[], weekday: number): boolean {
  return businessDays.includes(weekday);
}

// Weekday (0–6) of a naive local date string ("YYYY-MM-DD" or
// "YYYY-MM-DDTHH:mm"). Built from explicit calendar parts so the result is the
// intended calendar weekday regardless of the runtime timezone.
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

// Human summary of the open days: "Closed", "Every day", a contiguous range
// ("Mon–Sat") or a comma list ("Mon, Wed, Fri").
export function formatBusinessDays(businessDays: number[]): string {
  const days = sanitizeDays(businessDays);
  if (days.length === 0) return "Closed";
  if (days.length === 7) return "Every day";
  // Contiguous run in Monday-first order → render as a range.
  const idx = days.map((d) => WEEKDAY_ORDER.indexOf(d)).sort((a, b) => a - b);
  const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (contiguous && days.length >= 3) {
    return `${WEEKDAY_SHORT[WEEKDAY_ORDER[idx[0]]]}–${WEEKDAY_SHORT[WEEKDAY_ORDER[idx[idx.length - 1]]]}`;
  }
  return idx.map((i) => WEEKDAY_SHORT[WEEKDAY_ORDER[i]]).join(", ");
}
