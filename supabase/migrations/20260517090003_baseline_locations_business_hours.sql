-- Part of the dashboard-tables baseline (see 20260517090000). business_hours
-- columns on locations (staff settings page) were added directly in the
-- Supabase dashboard, never captured by a migration. Mirrors prod's current
-- locations schema. Needed by 20260611120000_dashboard_stats.sql.

alter table public.locations
  add column if not exists business_hours_start smallint not null default 8,
  add column if not exists business_hours_end smallint not null default 18;
