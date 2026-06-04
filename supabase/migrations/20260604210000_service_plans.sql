-- Service plans (Phase 6 PR1). Recurring maintenance memberships a garage sells
-- to customers via Stripe subscriptions on their connected account. Billing +
-- record only: we create the subscription and track its status; entitlements
-- (discounts, free MOT, auto-booking) come later. All location-scoped — reads
-- via the RLS member policy, writes via staff-context-checked actions on the
-- admin client; customer-portal reads use the admin client server-side.

create table if not exists public.service_plans (
  id                      uuid primary key default uuid_generate_v4(),
  location_id             uuid not null references public.locations(id) on delete cascade,
  name                    text not null,
  description             text,
  price_monthly_pence     integer,
  price_annual_pence      integer,
  stripe_product_id       text,
  stripe_price_monthly_id text,
  stripe_price_annual_id  text,
  active                  boolean not null default true,
  created_by              uuid,
  created_at              timestamptz not null default now(),
  -- at least one billing interval must be priced
  constraint service_plans_has_price
    check (price_monthly_pence is not null or price_annual_pence is not null)
);
create index if not exists service_plans_location_idx on public.service_plans (location_id, active);
alter table public.service_plans enable row level security;
create policy "service_plans_member_read"
  on public.service_plans for select using (public.is_location_member(location_id));

create table if not exists public.plan_subscriptions (
  id                     uuid primary key default uuid_generate_v4(),
  location_id            uuid not null references public.locations(id) on delete cascade,
  service_plan_id        uuid references public.service_plans(id) on delete set null,
  customer_id            uuid references public.customers(id) on delete set null,
  stripe_subscription_id text unique,
  stripe_customer_id     text,
  interval               text check (interval in ('month', 'year')),
  status                 text not null default 'incomplete',
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists plan_subscriptions_location_idx on public.plan_subscriptions (location_id);
create index if not exists plan_subscriptions_customer_idx on public.plan_subscriptions (customer_id);
alter table public.plan_subscriptions enable row level security;
create policy "plan_subscriptions_member_read"
  on public.plan_subscriptions for select using (public.is_location_member(location_id));
