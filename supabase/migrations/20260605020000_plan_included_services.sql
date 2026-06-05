-- Plan included-services allowance (Phase 6 PR3b). A service plan can bundle
-- catalogue services a number of times per billing period; a member's invoice
-- covers those services (£0) up to the allowance, then the plan discount applies
-- to the rest. Usage is tracked per subscription + billing period (keyed by the
-- subscription's current_period_end) so it resets each renewal with no cron.

-- The bundle: which services, how many per period.
create table if not exists public.service_plan_items (
  id                   uuid primary key default uuid_generate_v4(),
  service_plan_id      uuid not null references public.service_plans(id) on delete cascade,
  service_id           uuid not null references public.services(id) on delete cascade,
  quantity_per_period  integer not null default 1 check (quantity_per_period > 0),
  created_at           timestamptz not null default now()
);
create index if not exists service_plan_items_plan_idx on public.service_plan_items (service_plan_id);
alter table public.service_plan_items enable row level security;
create policy "service_plan_items_member_read"
  on public.service_plan_items for select using (
    exists (
      select 1 from public.service_plans sp
      where sp.id = service_plan_id and public.is_location_member(sp.location_id)
    )
  );

-- The usage ledger: how much of an allowance a member has consumed this period.
create table if not exists public.plan_service_usage (
  id                   uuid primary key default uuid_generate_v4(),
  plan_subscription_id uuid not null references public.plan_subscriptions(id) on delete cascade,
  service_id           uuid not null references public.services(id) on delete cascade,
  invoice_id           uuid references public.invoices(id) on delete cascade,
  period_end           timestamptz not null,
  covered_qty          integer not null default 0,
  created_at           timestamptz not null default now()
);
create index if not exists plan_service_usage_period_idx
  on public.plan_service_usage (plan_subscription_id, period_end);
alter table public.plan_service_usage enable row level security;
create policy "plan_service_usage_member_read"
  on public.plan_service_usage for select using (
    exists (
      select 1 from public.plan_subscriptions ps
      where ps.id = plan_subscription_id and public.is_location_member(ps.location_id)
    )
  );

-- Invoice-level membership credit (the £ value of covered included services).
alter table public.invoices
  add column if not exists membership_credit_amount numeric not null default 0,
  add column if not exists membership_credit_description text;
