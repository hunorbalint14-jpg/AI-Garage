# Tenant billing lapse policy

What happens when a garage's platform subscription trial ends or a payment
fails (issue #453). Code: `src/lib/tenant-plans.ts` (`tenantBillingState`,
`tenantBillingActive`, `entitledTo`, `effectiveFeePercent`).

## The invariant

**Billing state never gates core trading.** A garage can always create and
complete jobs, raise and send invoices, and take customer payments — whatever
its billing state. A lapse degrades the account to the free Starter tier's
*features* and *fee rate*; it never locks staff out, blocks in-progress work,
or deletes data. There is no "read-only mode" and no hard gate, by design.

## States

`tenantBillingState(org, now)` derives one of five states from
`tenant_plan`, `tenant_subscription_status`, `tenant_current_period_end`,
`tenant_trial_end`:

| State | When | Premium features | Platform fee |
|---|---|---|---|
| `ok` | Free Starter; or a live subscription (`active`/`trialing`); or a live courtesy trial | On (per tier) | Tier rate |
| `trial_ending` | Courtesy trial live, ≤ 7 days left (`TRIAL_ENDING_WINDOW_DAYS`) | On | Tier rate |
| `grace` | Subscription `past_due`, within `tenant_current_period_end` + 7 days (`TENANT_BILLING_GRACE_DAYS`) | On | Tier rate |
| `trial_ended` | Courtesy trial expired, org never subscribed | **Off** | **Starter 2%** |
| `lapsed` | Grace expired, or subscription `canceled` / `unpaid` / `incomplete_expired` | **Off** | **Starter 2%** |

"Good standing" (`tenantBillingActive`) = `ok`, `trial_ending`, or `grace`.

Notes:

- **Courtesy trial** = `tenant_trial_end`, the 30-day Pro trial granted to
  grandfathered orgs in migration `20260605030000_tenant_billing.sql`. New
  signups start on free Starter with no trial. Paid-tier trials created
  through Stripe Checkout surface as `trialing` status instead.
- A live courtesy trial outranks a dead subscription status (a canceled org
  still inside its trial keeps features until the trial ends).
- `canceled` / `incomplete_expired` webhooks also reset `tenant_plan` to
  `starter` (`recordTenantSubscription`). `unpaid` keeps the stamped tier —
  it fails `tenantBillingActive` the same, but reactivating restores the tier
  without re-choosing a plan.

## Per-surface behaviour on `trial_ended` / `lapsed`

| Surface | Behaviour |
|---|---|
| Jobs, bookings, bays, quotes, invoices, customer payments, reminders | **Unchanged.** Never billing-gated. |
| Customer payments' platform fee | Reverts to Starter 2% (`effectiveFeePercent`) on every payment path. |
| Xero sync, campaigns, automations, AI receptionist | Gated off via `entitledTo()` in pages + server actions; `FeatureGateBanner` shows the upgrade message. Config/data untouched — features resume instantly when billing recovers. |
| Adding locations | Capped at the effective tier (Starter = 1) — `settings/actions.ts`. Existing branches stay fully accessible; nothing is archived. |
| Staff banner | Owner-only `TenantBillingNudge` in the staff layout: `trial_ending` is dismissible; `trial_ended`, `grace` (payment failed, shows grace deadline) and `lapsed` (red) are persistent until resolved. Hidden on the billing page itself. |
| Billing settings page | State callout: grace deadline, trial-ended date, or lapsed notice, plus the *effective* fee. |
| Data | Never deleted or exported-then-purged on lapse. No retention change. |

## Recovery

Owner → Settings → Billing → checkout (never subscribed) or Stripe Billing
Portal (card fix / plan change). The `customer.subscription.*` webhooks call
`recordTenantSubscription`, and the billing page self-heals by reconciling
from Stripe on load even if a webhook was missed.

## Tests

`src/lib/tenant-plans.test.ts` — state-machine cases (trial boundaries, grace
window, unpaid/canceled) plus a simulated lapsed tenant asserting the
invariants above.
