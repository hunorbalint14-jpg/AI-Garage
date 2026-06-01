-- Idempotency ledger for Stripe webhook events. Stripe delivers events
-- at-least-once (retries on non-2xx, plus occasional duplicate deliveries), so
-- the handler must process each event.id exactly once. The handler claims an
-- event by inserting its id here before doing any work; a duplicate delivery
-- hits the primary-key conflict and is acknowledged without re-running side
-- effects that are NOT themselves idempotent (Xero payment/payout pushes,
-- booking-invoice generation + email).
--
-- `processed_at` is set when handling completes. If processing throws, the
-- handler deletes the claim so Stripe's retry can reprocess.
--
-- This is payments infrastructure, not tenant data: rows are written/read only
-- by the service-role admin client (which bypasses RLS). RLS is enabled with NO
-- policies so any anon/authenticated access is denied by default.

create table if not exists public.stripe_webhook_events (
  id           text primary key,          -- Stripe event id (evt_...)
  type         text not null,             -- e.g. checkout.session.completed
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);

-- Lets a periodic cleanup prune old rows efficiently.
create index if not exists stripe_webhook_events_received_at_idx
  on public.stripe_webhook_events (received_at);

alter table public.stripe_webhook_events enable row level security;
-- No policies: deny all to anon/authenticated. Service role bypasses RLS.
