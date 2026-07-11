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

export const BETA_SURFACES: BetaSurface[] = [
  {
    key: "deferred",
    label: "Deferred work (bank + follow-ups)",
    chip: { navKey: "deferred" },
    launchedOn: "2026-07-10",
    auditActions: ["deferred.followup_sent", "deferred.recovered", "deferred.dismissed", "deferred.reopened"],
    aiFeatures: ["deferred_followup_draft"],
  },
  {
    key: "receptionist",
    label: "AI receptionist",
    chip: { navKey: "receptionist" },
    launchedOn: "2026-07-06", // beta framing from the release-notes launch (#441)
    auditActions: [
      "receptionist.booking_created",
      "receptionist.handed_off",
      "receptionist.number_provisioned",
      "receptionist.config_update",
    ],
    aiFeatures: ["receptionist"],
  },
  {
    key: "support_assist",
    label: "Support assistant (widget)",
    chip: { note: "BETA chip in the support widget header" },
    launchedOn: "2026-07-06",
    auditActions: [],
    aiFeatures: ["support_assist"],
  },
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
