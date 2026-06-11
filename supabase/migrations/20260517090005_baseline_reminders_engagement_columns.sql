-- Part of the dashboard-tables baseline (see 20260517090000). Resend
-- delivery/open/click tracking columns on reminders were added directly in
-- the Supabase dashboard, never captured by a migration. Also, prod allows
-- vehicle_id to be null (e.g. campaign reminders not tied to a vehicle),
-- but the original migration had it not null. Mirrors prod's current
-- reminders schema.

alter table public.reminders
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz,
  alter column vehicle_id drop not null;
