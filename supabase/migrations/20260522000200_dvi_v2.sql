-- DVI v2: rebook prefill, deposit-on-approval, in-app staff notifications.

-- ---------------------------------------------------------------------------
-- 1. Bookings link back to the quote that originated them (rebook flow).
-- When the customer declines a quote but picks "book a separate appointment",
-- the booking widget submits a booking row that carries this FK so that
-- startBooking() can seed the new job with the snapshot items.
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column if not exists from_quote_id uuid
    references public.job_quotes(id) on delete set null;

create index if not exists bookings_from_quote_idx
  on public.bookings (from_quote_id)
  where from_quote_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Per-org deposit-on-approval policy. Default 0 = no deposit.
-- Range 0–100 percent of the quote total. When > 0 the customer is sent to
-- Stripe Checkout immediately after pressing "Approve"; items are only
-- applied after the deposit webhook lands.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists quote_deposit_pct numeric(5,2) not null default 0
    check (quote_deposit_pct >= 0 and quote_deposit_pct <= 100);

-- Track deposit state on the quote itself so partial-approval + deposit
-- combinations stay coherent.
alter table public.job_quotes
  add column if not exists deposit_pct numeric(5,2),
  add column if not exists deposit_amount numeric(10,2),
  add column if not exists deposit_required boolean not null default false,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

create index if not exists job_quotes_deposit_session_idx
  on public.job_quotes (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- 3. In-app notifications for staff. Email already fires on every quote
-- response — this surface adds a bell badge in the staff dashboard so the
-- mechanic sees responses without leaving the app.
-- ---------------------------------------------------------------------------
create table if not exists public.staff_notifications (
  id uuid primary key default gen_random_uuid(),

  -- Targeted at a single user (the mechanic who raised the quote), but
  -- additionally any location member can see it via the location_id fan-out
  -- policy below — that's intentional so a covering mechanic can also act.
  user_id uuid references auth.users(id) on delete cascade,

  -- Required: scopes the notification to a tenant.
  location_id uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,

  -- "<entity>.<verb>" — keeps room to grow without schema changes.
  kind text not null,

  title text not null,
  body text,
  -- Where clicking the bell takes the user. Relative path.
  href text,

  entity_type text,
  entity_id uuid,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists staff_notifications_user_unread_idx
  on public.staff_notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists staff_notifications_location_idx
  on public.staff_notifications (location_id, created_at desc);

alter table public.staff_notifications enable row level security;

-- A location member can see any notification scoped to their location.
-- This lets a covering mechanic see responses targeted at the original
-- mechanic. The `user_id` column is informational, not gating.
create policy "staff_notifications_member_select"
  on public.staff_notifications for select
  using (public.is_location_member(location_id));

-- Members can mark their own (or any location-scoped) notification read.
-- Inserts only happen through the service role from server actions.
create policy "staff_notifications_member_update"
  on public.staff_notifications for update
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));
