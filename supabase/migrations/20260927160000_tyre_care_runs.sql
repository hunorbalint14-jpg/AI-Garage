-- Tyre-care run log (#596, docs/tyre-care-build-spec.md, PR 6).
-- One row per branch per nightly evaluation. The engine already looks at
-- every home-branch vehicle, so it records how many had enough data to be
-- judged — the coverage metric — instead of the metrics page re-running the
-- engine over the whole fleet on every page load.

create table if not exists public.tyre_care_runs (
  id              bigint generated always as identity primary key,
  location_id     uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  ran_at          timestamptz not null default now(),
  -- Home-branch, non-demo vehicles the run reached.
  vehicles        integer not null default 0,
  -- ...of which the garage has worked on (the only ones eligible at all).
  with_history    integer not null default 0,
  -- ...of which had enough dated odometer readings for a mileage estimate.
  with_estimate   integer not null default 0,
  raised          integer not null default 0,
  refreshed       integer not null default 0,
  expired         integer not null default 0,
  -- The run hit its time budget: counts cover only the vehicles it reached.
  truncated       boolean not null default false
);

create index if not exists tyre_care_runs_location_idx on public.tyre_care_runs (location_id, ran_at desc);

create trigger set_org_from_location
  before insert on public.tyre_care_runs
  for each row execute function private.set_org_from_location();

alter table public.tyre_care_runs enable row level security;

-- Read-only to branch staff; written by the cron through the admin client.
create policy "tyre_care_runs_member_read" on public.tyre_care_runs
  for select to authenticated
  using (private.is_location_member(location_id));
