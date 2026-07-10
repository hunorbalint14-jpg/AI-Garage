-- Migration toolkit (#505 PR 2): import batches + imported service history.
-- Writes are admin-client only (server actions); staff read org-wide.

create table if not exists public.import_batches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  kind            text not null check (kind in ('customers', 'history', 'reminders')),
  filename        text,
  total_rows      integer not null default 0,
  imported_rows   integer not null default 0,
  rejected_rows   integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists import_batches_org_idx on public.import_batches (organization_id, created_at desc);

-- Service history that predates this platform. NOT jobs — deliberately kept
-- out of the board, time tracking, margins and revenue.
create table if not exists public.vehicle_history_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vehicle_id      uuid not null references public.vehicles(id) on delete cascade,
  happened_on     date not null,
  mileage         integer,
  description     text not null,
  total           numeric(10,2),
  source          text not null default 'import' check (source in ('import', 'manual')),
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists vehicle_history_vehicle_idx on public.vehicle_history_entries (vehicle_id, happened_on desc);
create index if not exists vehicle_history_batch_idx on public.vehicle_history_entries (import_batch_id);

alter table public.import_batches enable row level security;
alter table public.vehicle_history_entries enable row level security;

drop policy if exists "import_batches_select" on public.import_batches;
create policy "import_batches_select" on public.import_batches
  for select to authenticated
  using (private.is_org_staff(organization_id));

drop policy if exists "vehicle_history_select" on public.vehicle_history_entries;
create policy "vehicle_history_select" on public.vehicle_history_entries
  for select to authenticated
  using (private.is_org_staff(organization_id));
