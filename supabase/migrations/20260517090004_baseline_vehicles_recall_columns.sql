-- Part of the dashboard-tables baseline (see 20260517090000). DVSA recall
-- tracking and DVLA tax-due columns on vehicles were added directly in the
-- Supabase dashboard, never captured by a migration. Mirrors prod's current
-- vehicles schema.

alter table public.vehicles
  add column if not exists recall_status text,
  add column if not exists recall_checked_at timestamptz,
  add column if not exists recall_detail text,
  add column if not exists tax_due_date date;
