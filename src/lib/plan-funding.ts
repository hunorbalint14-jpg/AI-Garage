// Decision logic for service-plan funding accrual on Stripe `invoice.paid`.
//
// `plan_subscriptions.paid_in_pence` is the cumulative payments-in that drives
// the prepayment funding gate (docs/ai-garage-policy-build-spec §3.1). It is
// only ever moved by the invoice.paid accrual — but the subscription ROW is
// created by a *different* event (checkout.session.completed). Stripe does not
// guarantee event ordering, so invoice.paid for the first invoice can arrive
// before the row exists. This pure function decides what the webhook should do,
// so the ordering handling is unit-testable without the route/DB/Stripe stack.

export const PLAN_FUNDING_RETRY_GRACE_MS = 15 * 60 * 1000; // 15 minutes

export type PlanFundingDecision =
  | { action: "accrue"; amountPence: number }
  | { action: "retry"; reason: string }
  | { action: "skip"; reason: string };

export function decidePlanFunding(args: {
  /** Subscription id resolved from the invoice, or null if none. */
  subId: string | null;
  /** invoice.amount_paid, in pence. */
  amountPaid: number;
  /** Whether a plan_subscriptions row for subId already exists. */
  rowExists: boolean;
  /** True when the event carries event.account — i.e. a connected-account
   *  (service-plan) invoice. Platform-account invoices (tenant billing) don't. */
  hasConnectedAccount: boolean;
  /** How long ago the Stripe event was created, in ms. */
  eventAgeMs: number;
  graceMs?: number;
}): PlanFundingDecision {
  const {
    subId,
    amountPaid,
    rowExists,
    hasConnectedAccount,
    eventAgeMs,
    graceMs = PLAN_FUNDING_RETRY_GRACE_MS,
  } = args;

  // Not a subscription invoice (or nothing was paid) — nothing to accrue.
  if (!subId || amountPaid <= 0) return { action: "skip", reason: "no-subscription-or-zero-amount" };

  // The row exists — accrue the payment.
  if (rowExists) return { action: "accrue", amountPence: amountPaid };

  // No row yet. Only connected-account invoices are service plans; a
  // platform-account invoice (tenant billing) legitimately has no row.
  if (!hasConnectedAccount) return { action: "skip", reason: "not-a-service-plan-invoice" };

  // A service-plan invoice with no row is almost certainly the ordering race:
  // invoice.paid beat checkout.session.completed. Ask Stripe to retry — but only
  // within a grace window, so a connected-account subscription that will never
  // have a row (e.g. one created directly in the garage's Stripe dashboard, with
  // no metadata for recordSubscriptionFromStripe) stops retrying instead of
  // erroring for days.
  if (eventAgeMs < graceMs) {
    return {
      action: "retry",
      reason: `plan_subscriptions row for ${subId} not found yet (likely arrived before checkout.session.completed) — asking Stripe to retry`,
    };
  }
  return { action: "skip", reason: "grace-expired-no-row" };
}
