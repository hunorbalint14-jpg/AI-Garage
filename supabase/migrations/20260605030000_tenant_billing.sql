-- SaaS tenant billing (Phase 6). Charges the garage (tenant) for the platform
-- itself via a subscription on the PLATFORM Stripe account — separate from the
-- Connect rail that bills a garage's own customers. Hybrid model: a flat per-org
-- tier (starter/pro/growth) that unlocks features and lowers the platform fee,
-- alongside the existing per-payment fee. PR1 tracks billing only (no gating).

alter table public.organizations
  add column if not exists tenant_plan text not null default 'starter'
    check (tenant_plan in ('starter', 'pro', 'growth')),
  add column if not exists tenant_subscription_status text,
  add column if not exists tenant_stripe_customer_id text,
  add column if not exists tenant_stripe_subscription_id text,
  add column if not exists tenant_current_period_end timestamptz,
  add column if not exists tenant_trial_end timestamptz;

create unique index if not exists organizations_tenant_subscription_idx
  on public.organizations (tenant_stripe_subscription_id)
  where tenant_stripe_subscription_id is not null;

-- Grandfather existing garages: keep them on the free Starter tier, but grant a
-- 30-day Pro trial so the upcoming gating (PR2) doesn't pull premium features
-- out from under anyone mid-use.
update public.organizations
  set tenant_trial_end = now() + interval '30 days'
  where tenant_trial_end is null;
