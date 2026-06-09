-- Inbound webhook delivery log for /admin/health (PR 5b). One row per processed
-- webhook from a provider (Stripe, Resend, …). Powers the webhook-delivery
-- panel + the webhook_5xx_rate alert. Platform-level, RLS-locked to the
-- service-role client. Raw rows are pruned to ~7 days by /api/cron/tick.

create table if not exists public.webhook_deliveries (
  id           bigint generated always as identity primary key,
  provider     text not null,            -- 'stripe', 'resend', …
  event_type   text,
  ok           boolean not null,
  status_code  int,
  latency_ms   int,
  error        text,
  received_at  timestamptz not null default now()
);

create index if not exists webhook_deliveries_provider_time_idx
  on public.webhook_deliveries (provider, received_at desc);
create index if not exists webhook_deliveries_time_idx
  on public.webhook_deliveries (received_at);

alter table public.webhook_deliveries enable row level security;
-- No policies = service-role only (createAdminClient bypasses RLS).
