-- Customer finance at quote (Tier 1 roadmap): provider-agnostic plumbing for
-- "Spread the cost" on the token-gated quote page. Bumper is the first live
-- adapter (PayByLink, hosted checkout); Payment Assist is stubbed until
-- partner API access lands.

-- Per-org provider credentials + knobs. API key/secret are AES-encrypted via
-- APP_ENCRYPTION_KEY before insert (same pattern as Xero tokens). Service-role
-- only — staff manage it through owner-gated server actions.
create table if not exists public.finance_provider_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('bumper', 'payment_assist')),
  enabled boolean not null default false,
  demo_mode boolean not null default true,
  api_key_encrypted text,
  secret_encrypted text,
  -- Quotes under this total don't show the finance option.
  min_amount numeric(10,2) not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

alter table public.finance_provider_configs enable row level security;
create policy "finance_provider_configs_service_only" on public.finance_provider_configs
  for all using (false) with check (false);

-- One row per application raised with a provider. token = the provider's id
-- for the application, our join key everywhere (Bumper return + status calls).
create table if not exists public.finance_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  provider text not null check (provider in ('bumper', 'payment_assist')),
  quote_source text not null check (quote_source in ('job', 'standalone')),
  quote_id uuid not null,
  quote_slug text not null,
  token text not null unique,
  order_reference text not null,
  amount numeric(10,2) not null,
  product_type text not null default 'paylater',
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'error')),
  redirect_url text,
  raw_last_status jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists finance_applications_quote_idx
  on public.finance_applications (quote_id);
create index if not exists finance_applications_open_idx
  on public.finance_applications (status)
  where status in ('pending', 'in_progress');

alter table public.finance_applications enable row level security;
create policy "finance_applications_member_read" on public.finance_applications
  for select to authenticated using (private.is_location_member(location_id));
