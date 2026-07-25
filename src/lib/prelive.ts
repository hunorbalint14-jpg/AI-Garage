// Prelive mode (#585). A branch is prelive until someone goes live, and while
// it is, no *unattended* message reaches its customers.
//
// The gate belongs here and in the cron routes — NOT in lib/email.ts, sms.ts or
// whatsapp.ts. A blanket guard at the send layer would also kill password
// resets, staff invites, support-ticket mail and owner onboarding, which are
// exactly what the owner needs working while they set the branch up.
//
// The rule: if a human pressed a button, it sends. If a cron decided, it holds.
//
// Pure module (no server-only imports) so client components can render the
// badge from the same predicate the crons use.

/** The shape every caller needs — the crons already select this column. */
export type LiveGated = { live_at: string | null };

/** True once the branch has been taken live. Prelive is the default for new branches. */
export function isLocationLive(location: LiveGated | null | undefined): boolean {
  return !!location?.live_at;
}

/** Inverse, for readability at call sites that skip. */
export function isPrelive(location: LiveGated | null | undefined): boolean {
  return !isLocationLive(location);
}

/** Uniform skip reason recorded in cron results, so a quiet run is explainable. */
export const PRELIVE_SKIP = "prelive" as const;

export const PRELIVE_BADGE_LABEL = "Prelive";

export const PRELIVE_EXPLAINER =
  "Automatic messages to customers are paused while this branch is prelive. You can import data, raise jobs and explore — nothing goes out on its own until you go live.";
