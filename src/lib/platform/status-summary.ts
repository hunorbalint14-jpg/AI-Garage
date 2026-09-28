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
