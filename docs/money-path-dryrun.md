# Money-path dry run (Stripe test mode) — #443

Full lifecycle exercised 2026-07-09 against a local stack (Supabase + `next dev`)
with the platform's **test-mode** Stripe key, `stripe listen` forwarding both
platform and connected-account events to `/api/webhooks/stripe`, and a seeded
demo tenant (`smith-motors`). Repeat it with the steps below after any change
to the payment, webhook, or refund paths.

## What was proven

| Step | Surface | Evidence checked |
|---|---|---|
| Connect Express onboarding | Settings → Payments → Connect Stripe → Stripe-hosted test onboarding | `organizations.stripe_account_id` stamped; `account.updated` webhook flipped `charges/payouts/details` flags; settings badge "Active" |
| Online booking | `/book` widget, anonymous customer | `bookings` + `customers` rows created |
| Booking → job | Booking detail → "Start work (create job card)" | `jobs` row, **booked service auto-added as first job item** |
| Line items | Job card → Add item (labour) | `job_items` rows; job completed |
| Invoice | Jobs board → "Invoice →" → Send to customer | `invoices` row linked to the job; VAT: subtotal £114.85 @ 20% = £22.97, total £137.82; status `sent` |
| Card payment | `/pay/{id}` → Stripe Checkout (4242… test card) | `checkout.session.completed` webhook set `status=paid`, `stripe_payment_intent_id`, `stripe_paid_amount_pence=13782` |
| Platform fee | PaymentIntent on the **connected** account | `application_fee_amount=276` = 2% (Starter tier) of 13782p — charge settles to the garage, fee to the platform |
| Partial refund | Invoice → Refund £50 | `credit_notes` CN with real `re_…` id; invoice `part_refunded`; `charge.refunded` webhook **deduped** (no second row) |
| Full refund | Invoice → Refund remainder | second CN (£87.82); invoice `refunded`; totals reconcile to the paid amount |
| Signature check | webhook route | unsigned/bad-signature POSTs rejected 400 (constructEvent) |

## Bug found and fixed during the run

**`charge.refunded` double-recorded every in-app refund.** Stripe API 2022-11+
omits `charge.refunds` from webhook payloads (needs explicit expand), so the
handler's fallback recorded the whole `amount_refunded` under a synthetic
`charge_…` id — bypassing the per-refund idempotency and duplicating the
credit note the staff action had already written (a £50 refund produced £100
of credit notes). Fixed in `src/app/api/webhooks/stripe/route.ts`: when the
event's refund list is empty, fetch the real refunds
(`stripe.refunds.list({charge}, {stripeAccount})`) and record those — their
`re_…` ids dedupe naturally against the staff-action row. Verified live:
partial + full refunds each produced exactly one credit note with both the
staff action and the webhook firing.

## How to re-run

1. `supabase start` + seeded demo tenant; `stripe listen --forward-to
   localhost:3000/api/webhooks/stripe --forward-connect-to
   localhost:3000/api/webhooks/stripe` (test key); start `npm run dev` with
   `STRIPE_WEBHOOK_SECRET` set to the listener's `whsec_…`.
2. `npx playwright test --config playwright.pr.config.ts pr-money-path
   --project=pr` (TEMP spec `e2e/screenshots/pr-money-path.spec.ts`, kept
   uncommitted like the other `pr-*` harnesses; recreate from this doc's steps
   if absent).
3. **Two legs are manual** — Stripe's hosted pages bot-block automation:
   - Express onboarding (CAPTCHA): owner login → Settings → Payments →
     Connect/Continue → "Use test phone number" → "Use test code" → "Skip
     this account form".
   - Checkout payment (loads once, then blocks headless retries): open
     `/pay/{invoiceId}` in a real browser, pay with `4242 4242 4242 4242`.
4. Assert the DB rows per the table above (`bookings`, `jobs`, `job_items`,
   `invoices`, `credit_notes`, `stripe_webhook_events`).

## Environment notes (local-only artefacts, correct in prod)

- `publicOrigin()` falls back to `https://ai-garage.co.uk` when
  `NEXT_PUBLIC_ROOT_DOMAIN` is a localtest domain, so Checkout success/cancel
  and Connect return URLs land on the prod site during local runs. Payment
  and webhooks are unaffected (the webhook is the source of truth); in prod
  the origin is right.
- `stripe listen`'s signing secret differs from the dashboard endpoint's —
  override `STRIPE_WEBHOOK_SECRET` for the dev server, don't edit `.env.local`.
