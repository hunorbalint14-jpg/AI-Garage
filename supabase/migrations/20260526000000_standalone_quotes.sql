-- Standalone quotes — sent to customers BEFORE a job exists.
-- Mirrors the DVI job_quotes table but ties to a customer + vehicle directly,
-- with an optional video and 30-day default validity (configurable per-org).
-- Customer responds via the same /quote/[slug]?t=... token-gated route as
-- DVI; slugs use the "sq-" prefix so the customer route can distinguish.

create table if not exists public.standalone_quotes (
  id uuid primary key default gen_random_uuid(),

  location_id uuid not null references public.locations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,

  title text,
  description text,                -- internal-only staff notes
  customer_message text,           -- shown to customer on the quote page

  -- Optional video — shares the job-quote-videos bucket. Path format:
  -- {location_id}/standalone/{quote_id}.{ext}
  video_path text,
  video_mime text,
  video_size_bytes integer,
  video_duration_seconds integer,

  subtotal numeric(10,2) not null default 0,
  vat_rate numeric(5,2) not null default 20,
  vat_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,

  status text not null default 'draft'
    check (status in ('draft','pending','approved','declined','rebooked',
                      'expired','cancelled','approved_after_close')),

  -- Token gate. Both null while status='draft'; minted on send.
  token_hash text,
  slug text unique,

  expires_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  viewed_count integer not null default 0,

  responded_at timestamptz,
  approved_item_ids uuid[] not null default '{}',
  decline_reason text,

  -- Deposit-on-approval (mirrors job_quotes v2).
  deposit_pct numeric(5,2),
  deposit_amount numeric(10,2),
  deposit_required boolean not null default false,
  deposit_paid_at timestamptz,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,

  -- Set when staff later converts the approved quote into a booking.
  converted_booking_id uuid references public.bookings(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists standalone_quotes_location_idx
  on public.standalone_quotes (location_id, created_at desc);
create index if not exists standalone_quotes_customer_idx
  on public.standalone_quotes (customer_id, created_at desc);
create index if not exists standalone_quotes_token_hash_idx
  on public.standalone_quotes (token_hash) where token_hash is not null;
create index if not exists standalone_quotes_pending_idx
  on public.standalone_quotes (expires_at) where status = 'pending';
create index if not exists standalone_quotes_deposit_session_idx
  on public.standalone_quotes (stripe_checkout_session_id) where stripe_checkout_session_id is not null;

create table if not exists public.standalone_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.standalone_quotes(id) on delete cascade,
  description text not null,
  type text not null check (type in ('part','labour','other')),
  quantity numeric(10,2) not null,
  unit_price numeric(10,2) not null,
  product_id uuid references public.products(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists standalone_quote_items_quote_idx
  on public.standalone_quote_items (quote_id, sort_order);

create or replace function public.standalone_quotes_increment_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.standalone_quotes
     set viewed_count = viewed_count + 1,
         viewed_at = coalesce(viewed_at, now()),
         updated_at = now()
   where id = p_id
     and status = 'pending'
     and expires_at > now();
$$;
revoke all on function public.standalone_quotes_increment_view(uuid) from public;
grant execute on function public.standalone_quotes_increment_view(uuid) to service_role;

create or replace function public.touch_standalone_quotes_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists standalone_quotes_touch_updated_at on public.standalone_quotes;
create trigger standalone_quotes_touch_updated_at
  before update on public.standalone_quotes
  for each row execute function public.touch_standalone_quotes_updated_at();

alter table public.standalone_quotes enable row level security;
alter table public.standalone_quote_items enable row level security;

create policy "standalone_quotes_member_all"
  on public.standalone_quotes for all
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));

create policy "standalone_quote_items_member_all"
  on public.standalone_quote_items for all
  using (
    exists (
      select 1 from public.standalone_quotes q
       where q.id = standalone_quote_items.quote_id
         and public.is_location_member(q.location_id)
    )
  )
  with check (
    exists (
      select 1 from public.standalone_quotes q
       where q.id = standalone_quote_items.quote_id
         and public.is_location_member(q.location_id)
    )
  );

-- Per-org default validity period for standalone quotes (UK standard = 30 days).
alter table public.organizations
  add column if not exists quote_validity_days integer not null default 30
    check (quote_validity_days between 1 and 365);
