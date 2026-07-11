// Beta-surface registry (#456): the single list of what currently wears a
// BETA chip, when it launched, and where its usage signal lives. The admin
// Beta page renders days-live + usage counts from this; a unit test keeps it
// in lockstep with the actual `beta: true` nav flags so the tracker can't
// drift from the chips. Graduating a surface = remove its chip AND its entry
// in the same PR.

export type BetaSurface = {
  key: string;
  label: string;
  /** Where the chip lives — nav item key (staff-modules), or a description
   * for non-nav chips (feature-flag rollouts, widget headers). */
  chip: { navKey: string } | { note: string };
  /** Launch date of the beta framing (ISO date). */
  launchedOn: string;
  /** audit_log actions that count as "used". */
  auditActions: string[];
  /** ai_usage_events feature keys that count as "used". */
  aiFeatures: string[];
};

// Graduated with the #456 gate call (this PR): deferred work, AI
// receptionist, support assistant — their chips are gone, so their entries
// go too (the lockstep test enforces it). eVHC stays: its beta framing is
// the feature-flag rollout, not a nav chip.
export const BETA_SURFACES: BetaSurface[] = [
  {
    key: "evhc",
    label: "eVHC — vehicle health checks",
    chip: { note: "feature-flag rollout (evhc); release note titled (beta)" },
    launchedOn: "2026-07-10",
    auditActions: ["inspection.start", "inspection.complete", "inspection.send", "inspection.respond"],
    aiFeatures: ["inspection_rewrite"],
  },
];

export function daysLive(launchedOn: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(launchedOn).getTime()) / 86_400_000));
}
