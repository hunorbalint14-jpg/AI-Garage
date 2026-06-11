-- Part of the dashboard-tables baseline (see 20260517090000). The
-- permissions column default on location_users was changed directly in the
-- Supabase dashboard after 20260527000000_team_roles_permissions.sql set it
-- to '{}'::jsonb, to a starter shape matching the legacy permission set.
-- Mirrors prod's current default; new-row backfill of richer permission
-- shapes still happens via role_templates / app code.

alter table public.location_users
  alter column permissions set default '{"bays": false, "staff": false, "revenue": false, "bookings": true, "services": false, "campaigns": false, "customers": true, "reminders": true}'::jsonb;
