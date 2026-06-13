// Pure EV-readiness helpers. IMI TechSafe levels; level >= 2 is the bar for
// working on a high-voltage vehicle.

export const EV_LEVEL_LABELS: Record<number, string> = {
  1: "Level 1 — EV awareness",
  2: "Level 2 — routine maintenance",
  3: "Level 3 — HV component repair",
  4: "Level 4 — HV diagnosis & repair",
};

export const HV_QUALIFIED_MIN_LEVEL = 2;

export function isHvQualified(level: number | null | undefined): boolean {
  return (level ?? 0) >= HV_QUALIFIED_MIN_LEVEL;
}

export function qualExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < now;
}

// Whether a DVLA fuel type means the vehicle carries a high-voltage battery.
// VES uses "ELECTRICITY" for pure EVs and "HYBRID ELECTRIC" for hybrids;
// match any "electric" wording defensively, but exclude petrol/diesel-only.
export function isHighVoltageFuel(fuelType: string | null | undefined): boolean {
  if (!fuelType) return false;
  return /electric|hybrid/i.test(fuelType);
}

export type HvWarning =
  | { kind: "none" }
  | { kind: "no_qualified_techs" }
  | { kind: "assignee_unqualified"; assigneeName: string }
  | { kind: "assignee_expired"; assigneeName: string };

// Warning for a high-voltage job given the assignee's qual and whether the
// location has anyone qualified at all.
export function hvWarningFor(args: {
  highVoltage: boolean;
  assigneeName: string | null;
  assigneeLevel: number | null;
  assigneeExpiresAt: string | null;
  locationHasQualified: boolean;
  now?: Date;
}): HvWarning {
  if (!args.highVoltage) return { kind: "none" };
  if (!args.locationHasQualified) return { kind: "no_qualified_techs" };
  if (args.assigneeName === null) return { kind: "none" }; // unassigned — nothing to warn about yet
  if (!isHvQualified(args.assigneeLevel)) {
    return { kind: "assignee_unqualified", assigneeName: args.assigneeName };
  }
  if (qualExpired(args.assigneeExpiresAt, args.now)) {
    return { kind: "assignee_expired", assigneeName: args.assigneeName };
  }
  return { kind: "none" };
}
