-- EV / SERMI readiness (Tier 2 roadmap). SERMI went live in the UK April
-- 2026 — garages need accreditation to access security-related repair data.
-- Track per-location SERMI status, per-technician EV qualifications (IMI
-- TechSafe levels), and flag high-voltage jobs so unqualified hands stay out.

create table if not exists public.location_ev_readiness (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references public.locations(id) on delete cascade,
  sermi_status text not null default 'not_applied'
    check (sermi_status in ('not_applied', 'applied', 'accredited', 'lapsed')),
  sermi_reference text,
  sermi_expires_at date,
  notes text,
  updated_at timestamptz not null default now()
);

alter table public.location_ev_readiness enable row level security;
create policy "location_ev_readiness_member_read" on public.location_ev_readiness
  for select to authenticated using (private.is_location_member(location_id));

-- One qualification row per technician per location. Level follows IMI
-- TechSafe: 1 awareness, 2 routine maintenance, 3 HV component repair,
-- 4 HV diagnosis. Level >= 2 counts as qualified to touch a HV job.
create table if not exists public.staff_ev_quals (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  level smallint not null check (level between 1 and 4),
  certified_at date,
  expires_at date,
  notes text,
  updated_at timestamptz not null default now(),
  unique (location_id, user_id)
);

alter table public.staff_ev_quals enable row level security;
create policy "staff_ev_quals_member_read" on public.staff_ev_quals
  for select to authenticated using (private.is_location_member(location_id));

alter table public.jobs
  add column if not exists high_voltage boolean not null default false;
