-- Technician assignment (Phase 3). Records which staff member is responsible
-- for a booking (the diary) and a job (the work). Nullable — unassigned is the
-- default. references auth.users so removing a staff account simply nulls the
-- assignment rather than blocking deletion.
--
-- Existing RLS on bookings/jobs already scopes access by location; no policy
-- change needed. Writes go through the staff-context-checked server actions.

alter table public.bookings
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

alter table public.jobs
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

create index if not exists bookings_location_assigned_idx
  on public.bookings (location_id, assigned_to);

create index if not exists jobs_location_assigned_idx
  on public.jobs (location_id, assigned_to);
