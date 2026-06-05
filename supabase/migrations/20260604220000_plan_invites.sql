-- Plan invites (Phase 6 PR2). Lets staff send a customer a tokenised link to
-- subscribe to a service plan without a portal login — the same token-gated
-- model as quotes / pay / doc-shares. The raw token is shown only in the link;
-- we store sha256(token). Subscribing still happens customer-side via Stripe
-- Checkout (card entry + SCA), so this is an enrolment shortcut, not a way for
-- staff to charge a card. Location-scoped; reads via the RLS member policy.

create table if not exists public.plan_invites (
  id              uuid primary key default uuid_generate_v4(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  service_plan_id uuid not null references public.service_plans(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  slug            text not null unique,
  token_hash      text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'subscribed', 'expired', 'cancelled')),
  expires_at      timestamptz not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  subscribed_at   timestamptz
);
create index if not exists plan_invites_location_idx on public.plan_invites (location_id);
create index if not exists plan_invites_customer_idx on public.plan_invites (customer_id);
create index if not exists plan_invites_slug_idx on public.plan_invites (slug);
alter table public.plan_invites enable row level security;
create policy "plan_invites_member_read"
  on public.plan_invites for select using (public.is_location_member(location_id));
