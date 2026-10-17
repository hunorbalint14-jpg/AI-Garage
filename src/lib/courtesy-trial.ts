// Pure helpers for platform-admin courtesy trials. No server imports, so the
// admin client component shares them with the server action.
//
// Courtesy trials granted by a platform admin (/admin/orgs/[id]): a paid tier
// with a tenant_trial_end and NO Stripe subscription — no card, no commitment.
// On expiry the org falls to `trial_ended` (Starter features + fee); nothing is
// ever charged. See docs/billing-lapse-policy.md.
export const COURTESY_TRIAL_MONTHS = [1, 3, 6, 12] as const;
export type CourtesyTrialMonths = (typeof COURTESY_TRIAL_MONTHS)[number];

// Subscription statuses that mean Stripe is (or is about to start) billing the
// org. A courtesy trial must not be granted on top of one — the subscription,
// not the trial, would decide the tier, and the owner would be paying anyway.
const BILLED_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

export function hasBilledSubscription(org: { tenant_subscription_status: string | null }): boolean {
  return !!org.tenant_subscription_status && BILLED_STATUSES.has(org.tenant_subscription_status);
}

// now + N calendar months, clamped to the target month's last day (31 Jan + 1
// month = 28/29 Feb, not 3 Mar).
export function courtesyTrialEnd(now: Date, months: number): Date {
  const end = new Date(now);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

// Stripe refuses a Checkout `subscription_data.trial_end` under 48h out. An
// hour of headroom covers clock skew between us and Stripe.
const STRIPE_MIN_TRIAL_MS = 49 * 60 * 60 * 1000;

// The `subscription_data.trial_end` (unix seconds) to carry a live courtesy
// trial into a new subscription, or null to bill immediately. An owner who
// subscribes mid-trial keeps the free months they were granted instead of
// paying from today; the webhook then records the sub as `trialing`, which
// tenantBillingState treats as ok. Null when there's no live courtesy trial,
// Stripe already bills the org, or the trial ends inside Stripe's 48h floor
// (those last hours are forfeited — Stripe won't schedule them).
export function checkoutTrialEnd(
  org: { tenant_trial_end: string | null; tenant_subscription_status: string | null },
  now: Date,
): number | null {
  if (!org.tenant_trial_end || hasBilledSubscription(org)) return null;
  const end = new Date(org.tenant_trial_end).getTime();
  if (Number.isNaN(end) || end - now.getTime() < STRIPE_MIN_TRIAL_MS) return null;
  return Math.floor(end / 1000);
}
