-- Plan coverage at booking + the prepayment "funding gate".
--
-- Per docs/ai-garage-policy-build-spec.md: a service plan must be PREPAYMENT,
-- not credit -- "no service/MOT is carried out under the plan until the
-- customer's accrued payments cover it" (§3.1). So a covered service is free
-- only when cumulative payments-in >= cumulative service value drawn (at walk-in
-- price) + this service, AND past the onboarding gate, AND within the per-period
-- allowance. On cancellation we refund the unspent balance less value taken at
-- walk-in price (§6).

-- 1. Subscriptions: the funding measure (cumulative payments-in, accrued from
--    Stripe invoice.paid) + the onboarding gate (when covered draws first become
--    allowed -- default created_at + 12 months unless enrolled after a service).
alter table public.plan_subscriptions
  add column if not exists paid_in_pence bigint not null default 0;
alter table public.plan_subscriptions
  add column if not exists benefits_start_at timestamptz;

-- 2. Usage ledger: link a draw to its booking, track reserve -> consume ->
--    release, and record the walk-in value drawn (for the funding gate + the
--    cancellation refund). Existing rows default to 'consumed' (drawn at invoice).
alter table public.plan_service_usage
  add column if not exists booking_id uuid references public.bookings(id) on delete set null;
alter table public.plan_service_usage
  add column if not exists status text not null default 'consumed'
    check (status in ('reserved', 'consumed', 'released'));
alter table public.plan_service_usage
  add column if not exists walk_in_pence integer not null default 0;

create index if not exists plan_service_usage_booking_idx
  on public.plan_service_usage (booking_id) where booking_id is not null;
create index if not exists plan_service_usage_sub_status_idx
  on public.plan_service_usage (plan_subscription_id, status);

-- 3. Bookings: mark a GBP0 plan-covered draw so the webhook / invoice / UI skip
--    charging and link it back to the subscription it drew against.
alter table public.bookings
  add column if not exists covered_by_plan boolean not null default false;
alter table public.bookings
  add column if not exists plan_subscription_id uuid references public.plan_subscriptions(id) on delete set null;
