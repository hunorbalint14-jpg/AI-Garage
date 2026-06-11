-- MOT bulk-delta sync (Tier 1 roadmap). Nightly cron downloads the DVSA
-- bulk-download delta files (vehicles whose MOT data changed in the last
-- 24h), matches registrations against our vehicles table, refreshes
-- mot_expiry, and flags vehicles that were MOT'd somewhere other than the
-- garage that tracks them ("MOT'd elsewhere" → lapsed-customer win-back).

-- One row per processed delta file. Platform-level, RLS-locked to the
-- service-role client (same pattern as cron_runs). The filename unique
-- constraint is what makes the nightly run idempotent.
create table if not exists public.mot_delta_runs (
  id bigint generated always as identity primary key,
  filename text not null unique,
  file_created_on timestamptz,
  status text not null default 'done' check (status in ('done', 'error')),
  scanned_count integer not null default 0,
  matched_count integer not null default 0,
  updated_count integer not null default 0,
  moted_elsewhere_count integer not null default 0,
  error text,
  duration_ms integer,
  processed_at timestamptz not null default now()
);

alter table public.mot_delta_runs enable row level security;
-- No policies = service-role only (createAdminClient bypasses RLS).

alter table public.vehicles
  add column if not exists last_mot_test_date date,
  add column if not exists mot_synced_at timestamptz,
  add column if not exists moted_elsewhere_at timestamptz;

-- Staff-side "MOT'd elsewhere" win-back list per location.
create index if not exists vehicles_moted_elsewhere_idx
  on public.vehicles (location_id, moted_elsewhere_at)
  where moted_elsewhere_at is not null;
