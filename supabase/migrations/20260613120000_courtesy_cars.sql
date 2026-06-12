-- Courtesy car module (Tier 2 roadmap): loan diary, fuel/condition
-- checkout+return, digital agreement, DVLA licence share code capture.
-- Table stakes in incumbent GMS (Garage Hive, TechMan), absent here until now.

create table if not exists public.courtesy_cars (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  registration text not null,
  make text,
  model text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (location_id, registration)
);

alter table public.courtesy_cars enable row level security;
create policy "courtesy_cars_member_read" on public.courtesy_cars
  for select to authenticated using (private.is_location_member(location_id));

create table if not exists public.courtesy_car_loans (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  car_id uuid not null references public.courtesy_cars(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  loaned_at timestamptz not null default now(),
  due_back_at timestamptz,
  returned_at timestamptz,
  -- Fuel in eighths of a tank: 0 = empty … 8 = full.
  fuel_out smallint check (fuel_out between 0 and 8),
  fuel_in smallint check (fuel_in between 0 and 8),
  odometer_out integer,
  odometer_in integer,
  condition_out text,
  condition_in text,
  -- DVLA "view driving licence" share code, checked manually on gov.uk.
  licence_number text,
  licence_share_code text,
  -- Digital agreement: the customer types their name as signature; the text
  -- they agreed to is pinned by version so later wording changes don't
  -- retroactively alter what was signed.
  agreement_name text,
  agreement_version text,
  agreement_signed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One open loan per car — availability enforced at the database.
create unique index if not exists courtesy_car_loans_open_uniq
  on public.courtesy_car_loans (car_id)
  where returned_at is null;

create index if not exists courtesy_car_loans_location_idx
  on public.courtesy_car_loans (location_id, returned_at, loaned_at desc);

alter table public.courtesy_car_loans enable row level security;
create policy "courtesy_car_loans_member_read" on public.courtesy_car_loans
  for select to authenticated using (private.is_location_member(location_id));
