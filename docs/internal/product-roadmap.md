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

- ⏸️ **Error tracking** — Sentry (or chosen vendor). Wrap server actions + route
  handlers + a client error boundary; release/version tagging; no-op when the
  DSN env var is unset (same graceful pattern as the rate limiter). _Decision
  pending: vendor._
- ⬜ **CSP → enforce** — review the collected `Content-Security-Policy-Report-Only`
  data, add a nonce (or hash) path for the remaining inline scripts, then flip to
  an enforced `Content-Security-Policy`. Files: [next.config.ts](../../next.config.ts),
  [csp-report.ts](../../src/lib/csp-report.ts).
- ⬜ **Stripe webhook idempotency** — a `processed_stripe_events` table keyed by
  `event.id`; dedupe at the top of [webhooks/stripe](../../src/app/api/webhooks/stripe).
  Build this **before** any feature that adds payment events (dunning, refunds,
  plans). The deposit path is already partially idempotent via `deposit_paid_at`.

## Phase 1 — Retention quick wins (S–M) — *reuse reminders + comms + job lifecycle*

- ⬜ **Invoice dunning** — new reminder kind for overdue invoices; escalating
  schedule via [cron/reminders](../../src/app/api/cron/reminders); "Pay now" link
  (reuses the Stripe pay flow). Respects contact prefs.
- ⬜ **Post-job review funnel** — on job → complete, send a feedback request;
  public feedback page; high scores routed to a Google review link, low scores
  routed privately to the garage (protects public rating).

## Phase 2 — Customer portal expansion (M) — *shared customer auth + ownership + portal UI*

- ⬜ **Service history + DVI** — read-only past jobs, DVI reports/photos in the
  portal. Data already exists (`dvi_v2`, `job_items`). Owner-gated like the
  invoice page.
- ⬜ **Quotes in portal** — session-authenticated review / approve / decline /
  cancel; reuse the `approveQuote`/`declineQuote` core via an ownership-gated
  entry point (raw token is unrecoverable — sha256 only). Keep the token link for
  account-less customers. See [quote/[slug]/actions.ts](../../src/app/quote/[slug]/actions.ts).
- ⬜ **Document vault** — invoices archive, MOT certificates, service records.
- ⬜ **Reminder / contact-preference management** — customer opt-in/out.

## Phase 3 — Operations: scheduling & labour (M–L) — *builds on jobs + bays; feeds Phase 5 reporting*

- ⬜ **Technician assignment** — assign jobs/bookings to staff; per-technician
  schedule view alongside the bay model.
- ⬜ **Time tracking** — clock-in/out per job → labour actual vs estimate; feeds
  [ai-labour.ts](../../src/lib/ai-labour.ts) and Phase 5 productivity reporting.

## Phase 4 — Parts & stock (L) — *independent; extends `products`*

- ⬜ **Inventory** — stock levels on products; low-stock alerts; job-parts
  consumption decrements stock.
- ⬜ **Suppliers & purchase orders** — supplier records, POs. Optional later: a UK
  parts-catalogue feed (Euro Car Parts / GSF).

## Phase 5 — Financial depth (M–L) — *depends on Phase 0 idempotency + Phase 3 time data + Xero*

- ⬜ **Credit notes & refunds** — reverse an invoice; Stripe refund; Xero sync.
- ⬜ **Reporting** — aged debtors, technician productivity (needs Phase 3),
  VAT / Making Tax Digital prep.

## Phase 6 — Growth / monetization (L) — *largest; benefits from all prior infra*

- ⬜ **Service plans** — customer recurring maintenance via Stripe subscriptions.
- ⏸️ **SaaS tenant billing** — plans / seats / trials for garages themselves.
  _Decision pending: pursue platform-subscription revenue, or stay platform-fee
  only? Today's model is per-payment platform fee only._

## Cross-cutting (continuous)

- ⬜ **MFA for owners** — slot at the Phase 1/2 boundary (security).
- ⬜ **E2E tests (Playwright)** — start in Phase 0; expand each phase to cover new
  critical flows (booking, pay, quote-approve, dunning). Today only lib unit
  tests exist (vitest).

---

## Critical path

- `Phase 0 (idempotency)` → `Phase 5 (refunds)`
- `Phase 3 (time tracking)` → `Phase 5 (productivity reporting)`
- Everything else is largely parallelizable.

## Decisions log

| Date | Decision | Status |
|---|---|---|
| 2026-06-01 | Roadmap sequenced into 7 phases | ✅ agreed |
| — | Error-tracking vendor (Sentry vs other) | ⏸️ pending |
| — | SaaS tenant billing vs platform-fee-only (Phase 6) | ⏸️ pending |
