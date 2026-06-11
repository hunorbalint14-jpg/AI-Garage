-- Baseline for tables created directly in the Supabase dashboard, never
-- captured by a migration (see supabase/migrations/README.md). Captured via
-- `supabase db dump --linked --schema public` against prod on 2026-06-11.
-- Date-prefixed before 20260517100000_stripe_payments.sql, the first
-- migration that alters one of these tables.
--
-- This mirrors prod as-is, including RLS being enabled with no policies on
-- these 12 tables (read access goes through the service-role admin client).
-- Marked as already-applied via `supabase migration repair --status applied`
-- so it does not run against prod.

create table if not exists public.bays (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  description text,
  category text not null default 'general',
  price numeric(10,2),
  duration_minutes integer default 60,
  vat_included boolean not null default true,
  active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  category text not null,
  sku text,
  supplier text,
  unit_price numeric(10,2) not null default 0,
  cost_price numeric(10,2),
  stock_qty integer not null default 0,
  reorder_at integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_location on public.products (location_id);

create table if not exists public.fleet_companies (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  task_type text not null check (task_type in ('mot_reminders', 'service_reminders', 'tax_reminders', 'weekly_digest', 'invoice_dunning', 'review_requests')),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
  hour smallint not null default 9 check (hour >= 0 and hour <= 23),
  day_of_week smallint check (day_of_week >= 0 and day_of_week <= 6),
  next_run_at timestamptz,
  unique (location_id, task_type)
);

create table if not exists public.tyre_checks (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  checked_at date not null default current_date,
  nsf_depth numeric(4,1),
  osf_depth numeric(4,1),
  nsr_depth numeric(4,1),
  osr_depth numeric(4,1),
  nsf_replaced boolean default false,
  osf_replaced boolean default false,
  nsr_replaced boolean default false,
  osr_replaced boolean default false,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0,
  transports text[],
  device_name text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_webauthn_user on public.webauthn_credentials (user_id);

create table if not exists public.data_deletion_log (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid,
  customer_email_hash text,
  reason text not null,
  requested_by uuid,
  deleted_at timestamptz not null default now(),
  notes text
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60,
  type text not null default 'service',
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'complete', 'cancelled', 'no_show', 'payment_pending')),
  created_at timestamptz default now(),
  bay_id uuid references public.bays(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  paid_amount_pence integer,
  from_quote_id uuid,
  assigned_to uuid references auth.users(id) on delete set null
);

create index if not exists bookings_from_quote_idx on public.bookings (from_quote_id) where from_quote_id is not null;
create index if not exists bookings_location_assigned_idx on public.bookings (location_id, assigned_to);
create index if not exists bookings_location_scheduled_idx on public.bookings (location_id, scheduled_at);
create index if not exists bookings_stripe_payment_intent_idx on public.bookings (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  status text not null default 'open',
  description text,
  notes text,
  created_at timestamptz default now(),
  completed_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null
);

create index if not exists jobs_location_assigned_idx on public.jobs (location_id, assigned_to);
create index if not exists jobs_location_status_idx on public.jobs (location_id, status);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft',
  subtotal numeric(10,2) not null default 0,
  vat_rate numeric(5,2) not null default 20.00,
  vat_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  issued_at date,
  due_at date,
  paid_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_paid_at timestamptz,
  stripe_paid_amount_pence integer,
  booking_id uuid references public.bookings(id) on delete set null,
  xero_invoice_id text,
  xero_synced_at timestamptz,
  xero_payment_id text,
  last_dunned_at timestamptz,
  dunning_count integer not null default 0,
  discount_amount numeric not null default 0,
  discount_description text,
  membership_credit_amount numeric not null default 0,
  membership_credit_description text
);

create unique index if not exists invoices_booking_id_idx on public.invoices (booking_id) where booking_id is not null;
create index if not exists invoices_location_paid_at_idx on public.invoices (location_id, paid_at) where status = 'paid';
create index if not exists invoices_location_status_idx on public.invoices (location_id, status);
create index if not exists invoices_stripe_payment_intent_idx on public.invoices (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index if not exists invoices_xero_invoice_idx on public.invoices (xero_invoice_id) where xero_invoice_id is not null;

create table if not exists public.job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(10,2) not null default 0,
  type text not null default 'part',
  created_at timestamptz default now(),
  product_id uuid references public.products(id) on delete set null,
  service_id uuid references public.services(id) on delete set null
);

create index if not exists job_items_product_idx on public.job_items (product_id);
create index if not exists job_items_service_idx on public.job_items (service_id);

alter table public.bays enable row level security;
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.fleet_companies enable row level security;
alter table public.scheduled_tasks enable row level security;
alter table public.tyre_checks enable row level security;
alter table public.webauthn_credentials enable row level security;
alter table public.data_deletion_log enable row level security;
alter table public.bookings enable row level security;
alter table public.jobs enable row level security;
alter table public.invoices enable row level security;
alter table public.job_items enable row level security;
