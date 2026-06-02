-- Job time tracking (Phase 3). Each row is one clock-in→clock-out span by a
-- staff member against a job. ended_at null = currently clocked in; duration is
-- stamped on clock-out. Multiple staff can track the same job; the app enforces
-- a single open entry per user. Powers labour actual-vs-estimate and (later)
-- Phase 5 productivity reporting.

create table if not exists public.job_time_entries (
  id               uuid primary key default uuid_generate_v4(),
  job_id           uuid not null references public.jobs(id) on delete cascade,
  location_id      uuid not null references public.locations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_minutes int,
  note             text,
  created_at       timestamptz not null default now()
);

create index if not exists job_time_entries_job_idx on public.job_time_entries (job_id);
-- Fast "is this user already clocked in?" lookup.
create index if not exists job_time_entries_open_idx
  on public.job_time_entries (user_id) where ended_at is null;

alter table public.job_time_entries enable row level security;

-- Staff can read time entries for their location (surfaced on the job card).
-- All writes go through the staff-context-checked server actions on the admin
-- (service-role) client, which bypasses RLS.
create policy "job_time_entries_member_read"
  on public.job_time_entries for select
  using (public.is_location_member(location_id));
