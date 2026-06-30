-- Per-day opening hours + special/holiday date overrides. Supersedes the flat
-- model (single business_hours_start/_end applied to every business_days
-- weekday, added in 20260630120000) with per-weekday hours, plus one-off date
-- exceptions. Drives the public booking widget, the AI receptionist and the
-- staff bookings calendar.

-- 1. Per-day hours: { "<weekday 0=Sun..6=Sat>": { "open": <min from midnight>,
--    "close": <min> } }. A weekday absent = closed that day. Minutes give
--    30-minute precision (e.g. 510 = 08:30).
alter table public.locations
  add column if not exists business_hours jsonb not null default '{}'::jsonb;

-- 2. Backfill from the flat columns: every open weekday gets the single
--    open/close, in minutes. Guarded so it only runs while the old columns
--    still exist.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'locations' and column_name = 'business_days'
  ) then
    update public.locations l
    set business_hours = coalesce((
      select jsonb_object_agg(
        d::text,
        jsonb_build_object('open', l.business_hours_start * 60, 'close', l.business_hours_end * 60)
      )
      from unnest(l.business_days) as d
    ), '{}'::jsonb)
    where l.business_hours = '{}'::jsonb;
  end if;
end $$;

-- 3. One-off date overrides (bank holidays, Christmas, special opening). A row
--    for a date wins over the weekday's regular hours.
create table if not exists public.location_special_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  date date not null,
  is_closed boolean not null default true,
  open_minute smallint,
  close_minute smallint,
  note text,
  created_at timestamptz not null default now(),
  unique (location_id, date)
);

create index if not exists location_special_hours_location_date_idx
  on public.location_special_hours (location_id, date);

-- organization_id is backfilled from location_id on insert by the existing
-- private.set_org_from_location trigger.
create trigger set_org_from_location
  before insert on public.location_special_hours
  for each row execute function private.set_org_from_location();

alter table public.location_special_hours enable row level security;

-- Read: any member of the branch (branch staff + org owner/admin).
create policy "location_special_hours_select" on public.location_special_hours
  for select to authenticated
  using (private.is_location_member(location_id));

-- Write: org owners/admins (Settings is an owner/admin surface).
create policy "location_special_hours_insert" on public.location_special_hours
  for insert to authenticated
  with check (private.is_org_admin(organization_id));

create policy "location_special_hours_update" on public.location_special_hours
  for update to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));

create policy "location_special_hours_delete" on public.location_special_hours
  for delete to authenticated
  using (private.is_org_admin(organization_id));

-- 4. Drop business_days — fully superseded by business_hours (a weekday present
--    in the jsonb = open) and no longer read anywhere.
alter table public.locations
  drop column if exists business_days;

-- business_hours_start / _end are intentionally KEPT: the dashboard_stats() RPC
-- (20260614180000) reads them for the "today schedule" grid bounds. The settings
-- action keeps them in sync as the week's min-open / max-close (a coarse legacy
-- mirror). Migrating that RPC to per-day hours and then dropping these is a
-- follow-up.
