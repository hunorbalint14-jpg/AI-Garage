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
