# Product Roadmap

Sequenced feature roadmap for the AI Garage platform, ordered by **dependency +
ROI-per-effort + shared infrastructure** (features touching the same code are
grouped so each foundation is built once). Cheap/high-safety work first; large,
strategic builds last.

This is a living document — tick items as they ship, link the PR.

**Status legend:** ⬜ not started · 🟡 in progress · ✅ done · ⏸️ blocked/decision-pending

**Effort:** S (≤1 PR) · M (a few PRs) · L (multi-PR epic)

---

## Phase 0 — Foundations (S) — *de-risk before expanding*

- ✅ **Error tracking** — **Sentry** (server + edge + client, env-gated). Shipped #194, #195.
- ✅ **CSP → enforce** — promoted Report-Only → enforced `Content-Security-Policy`;
  fonts self-hosted, Supabase media allowed, Vercel Live preview-gated, violation
  reporting kept. Shipped #188 (+ #180, #179). Nonce path for inline scripts deferred.
- ✅ **Stripe webhook idempotency** — `stripe_webhook_events` ledger keyed by
  `event.id`, claim-first dedupe at the top of [webhooks/stripe](../../src/app/api/webhooks/stripe). Shipped #184.

## Phase 1 — Retention quick wins (S–M) — *reuse reminders + comms + job lifecycle*

- ✅ **Invoice dunning** — escalating overdue-payment reminders (cron) with a
  "Pay now" link; stops once paid. Shipped #190.
- ✅ **Post-job review funnel** — on job complete, request feedback; ≥4★ → Google
  review, <4★ → private staff alert. Shipped #191.

## Phase 2 — Customer portal expansion (M) — *shared customer auth + ownership + portal UI*

- ✅ **Service history + DVI** — read-only past jobs + DVI reports (signed-URL
  video) + tyre checks; owner-gated via `getPortalContext`/`requireOwned*`. Shipped #196 (foundation), #197.
- ✅ **Quotes in portal** — session-authenticated approve / decline / deposit via
  **isolated** owner actions (token revenue path untouched; reuses `applyApprovedItems`
  + the existing Stripe webhook). Token link still works for account-less customers. Shipped #198.
- ✅ **Document vault** — invoices, DVI reports, service records + per-vehicle GOV.UK
  MOT link (no cert storage). Shipped #199.
- ✅ **Contact-preference management** — customer marketing email/SMS opt-in/out. Shipped #200.

## Phase 3 — Operations: scheduling & labour (M–L) — *builds on jobs + bays; feeds Phase 5 reporting*

- ✅ **Technician assignment** — assign bookings + jobs to staff; "by technician"
  filter on the schedule. Shipped #202.
- ✅ **Time tracking** — clock in/out + pause/resume (active vs elapsed) + manual
  override; labour actual vs estimate on the job card. Shipped #204.

## Phase 4 — Parts & stock (L) — *independent; extends `products`*

- ✅ **Inventory** — job parts decrement stock on completion (credited on reopen);
  `reorder_at` low-stock view/badge/filter. Shipped #205.
- ✅ **Suppliers & purchase orders** — supplier CRUD; raise/order/receive POs;
  receiving replenishes stock. Shipped #206. _UK parts-catalogue feed still later._

## Phase 5 — Financial depth (M–L) — *depends on Phase 0 idempotency + Phase 3 time data + Xero*

- ⬜ **Credit notes & refunds** — reverse an invoice; Stripe refund; Xero sync.
- ⬜ **Reporting** — aged debtors, technician productivity (needs Phase 3),
  VAT / Making Tax Digital prep.

## Phase 6 — Growth / monetization (L) — *largest; benefits from all prior infra*

- 🟡 **Service plans** — customer recurring maintenance via Stripe subscriptions.
  PR1 shipped: staff define plans (monthly/annual), customer subscribes via Checkout
  on the garage's connected account (platform fee skimmed), subscription status tracked
  + cancel-at-period-end. **Billing + record only** — entitlements (member discount,
  free MOT, auto-scheduled service) are the next PRs.
  PR2 shipped: staff send a tokenised subscribe link (email/SMS, `/plan/[slug]`) from
  the customer page so they can enrol customers who aren't in the portal yet.
  PR3a shipped (first **entitlement**): a plan grants a **member discount** (percent or
  fixed £, staff's choice), auto-applied to a member's job invoices and reflected on every
  surface (UI / email / PDF / Xero).
  PR3b groundwork shipped: `job_items.service_id` links lines to the catalogue (#216).
  PR3b shipped: **included services × N** consumed allowance — a plan bundles catalogue
  services per billing period; a member's job invoice covers them (£0) up to the quota
  (membership credit), then the discount applies to the rest; usage tracked per
  subscription period (resets on renewal, no cron). Customer-facing "includes X" marketing
  copy on plan cards deferred (members see the credit on their invoice).
- 🟡 **SaaS tenant billing** — **decided: hybrid** — keep the per-payment platform fee
  **and** sell flat per-org tiers (Starter free / Pro / Growth) that unlock features and
  lower the fee; lapses handled soft + grace.
  PR1 shipped: org billing columns + `tenant-plans.ts` tier config + owner Billing page
  (Checkout + Stripe Billing Portal on the **platform** account) + webhook `tenant_billing`
  branch + an owner nudge. Tracking only — no gating yet (nudge-first).
  PR2 next: feature gating by tier + soft enforcement after grace. PR3: tier-based fee.

## Cross-cutting (continuous)

- ✅ **MFA for owners** — passkey step-up for owners + admins, behind the
  `OWNER_MFA_ENFORCED` flag (nudge-first). Shipped #201. _Flip the flag to enforce
  once owners have enrolled._
- 🟡 **E2E tests (Playwright)** — smoke scaffold shipped (config + CI `e2e` job +
  public, no-auth, DB-independent specs: home, staff-login, 404). Deeper authed
  flows (booking, pay, quote-approve, dunning) are **pending a throwaway Supabase
  test project + seed + CI secrets** the team provisions. Lib unit tests (vitest)
  remain the bulk of coverage.

---

## Critical path

- `Phase 0 (idempotency)` → `Phase 5 (refunds)`
- `Phase 3 (time tracking)` → `Phase 5 (productivity reporting)`
- Everything else is largely parallelizable.

## Decisions log

| Date | Decision | Status |
|---|---|---|
| 2026-06-01 | Roadmap sequenced into 7 phases | ✅ agreed |
| 2026-06-02 | Error-tracking vendor → **Sentry** | ✅ done (#194/#195) |
| 2026-06-02 | Phase 2 quotes via **isolated** owner actions (don't touch the token revenue path) | ✅ done (#198) |
| 2026-06-02 | Owner MFA **nudge-first** behind `OWNER_MFA_ENFORCED`; scope = owners + admins | ✅ done (#201) |
| — | Flip `OWNER_MFA_ENFORCED=true` once owners have enrolled | ⏸️ pending — **ops/env only** (Vercel), gated on owner enrolment; flipping early hard-blocks un-enrolled owners |
| 2026-06-04 | E2E Playwright **smoke scaffold** (public no-auth specs + CI job); authed flows deferred to a test DB | ✅ done |
| 2026-06-04 | Service plans PR1 = **billing + record only**, monthly+annual, on the garage's connected account; entitlements deferred | ✅ done |
| 2026-06-05 | SaaS tenant billing = **hybrid** (per-payment fee + flat per-org tiers, Starter free); soft+grace enforcement | ✅ decided |
