import { PLATFORM_COMPONENTS } from "@/lib/platform/components";

// What the public /status page shows, derived from the published, unresolved
// incidents. Pure so the rules are unit-tested.
//
// The headline follows EVERY published incident, whether or not it names the
// services it affects. It used to be derived from component rows only, so an
// incident with no components — every auto-declared one, and any manual one
// declared without ticking a service — sat under "All systems operational".

export type StatusTone = "ok" | "warn" | "bad";

const RANK: Record<StatusTone, number> = { ok: 0, warn: 1, bad: 2 };

export function severityTone(severity: string): StatusTone {
  return severity === "SEV-1" || severity === "SEV-2" ? "bad" : "warn";
}

function worse(a: StatusTone, b: StatusTone): StatusTone {
  return RANK[b] > RANK[a] ? b : a;
}

export function summariseStatus(incidents: { severity: string; components: string[] }[]): {
  overall: StatusTone;
  components: Map<string, StatusTone>;
  /** Some incident doesn't say which services it affects. */
  unmapped: boolean;
} {
  const components = new Map<string, StatusTone>(PLATFORM_COMPONENTS.map((c) => [c, "ok"]));
  let overall: StatusTone = "ok";
  let unmapped = false;
  for (const inc of incidents) {
    const tone = severityTone(inc.severity);
    overall = worse(overall, tone);
    const known = (inc.components ?? []).filter((c) => components.has(c));
    if (known.length === 0) unmapped = true;
    for (const c of known) components.set(c, worse(components.get(c)!, tone));
  }
  return { overall, components, unmapped };
}

// Times on the public page are UK wall-clock time. The server runs in UTC, so
// formatting without a zone showed BST incidents an hour early under a "GMT"
// label — next to the admin panel's browser-local times it looked stale.
const UK_DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});
const UK_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
});
const UK_TIME_ZONE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

/** e.g. "28 Sept, 12:10 BST". */
export function ukDateTime(value: string | Date): string {
  return UK_DATE_TIME.format(new Date(value));
}

/** e.g. "12:10". */
export function ukTime(value: string | Date): string {
  return UK_TIME.format(new Date(value));
}

/** e.g. "12:10 BST". */
export function ukTimeWithZone(value: string | Date): string {
  return UK_TIME_ZONE.format(new Date(value));
}

const UK_DAY_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const UK_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const UK_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** e.g. "28 Sept, 12:10" — for timelines that can span days. */
export function ukDayTime(value: string | Date): string {
  return UK_DAY_TIME.format(new Date(value));
}

// ── Past incidents ──────────────────────────────────────────────────────────

/** How far back the public "Past incidents" list reaches. */
export const PAST_INCIDENT_DAYS = 30;
/** Cap on rows, so a bad week can't make the page unbounded. */
export const PAST_INCIDENT_LIMIT = 25;

/** How long an incident lasted, e.g. "42 min", "3 h 5 min", "2 days 4 h". */
export function incidentDuration(startedAt: string, resolvedAt: string): string {
  const mins = Math.max(0, Math.round((Date.parse(resolvedAt) - Date.parse(startedAt)) / 60_000));
  if (!Number.isFinite(mins)) return "";
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rem = mins % 60;
    return rem ? `${hours} h ${rem} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return `${days} day${days === 1 ? "" : "s"}${remH ? ` ${remH} h` : ""}`;
}

/**
 * Group incidents under the UK calendar day they started on, newest day first,
 * keeping the input order within a day. Keys by the London date so an incident
 * at 00:30 BST lands on the right day, not the UTC one before it.
 */
export function groupByUkDay<T extends { started_at: string }>(items: T[]): { label: string; items: T[] }[] {
  const groups = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const key = UK_DAY_KEY.format(new Date(item.started_at));
    if (!groups.has(key)) groups.set(key, { label: UK_DAY.format(new Date(item.started_at)), items: [] });
    groups.get(key)!.items.push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0)).map(([, g]) => g);
}

/** ISO cutoff for the "Past incidents" query. */
export function pastIncidentsSince(now: Date): string {
  return new Date(now.getTime() - PAST_INCIDENT_DAYS * 86_400_000).toISOString();
}

/**
 * Start–end of a resolved incident. Same UK day → "11:06 – 11:48 BST" (the
 * list is already grouped under the day); across days → dates on both ends.
 */
export function incidentWindow(startedAt: string, resolvedAt: string): string {
  const sameDay = UK_DAY_KEY.format(new Date(startedAt)) === UK_DAY_KEY.format(new Date(resolvedAt));
  return sameDay
    ? `${ukTime(startedAt)} – ${ukTimeWithZone(resolvedAt)}`
    : `${ukDayTime(startedAt)} – ${ukDayTime(resolvedAt)}`;
}
