-- Part of the dashboard-tables baseline (see 20260517090000). GDPR/DPA
-- tracking columns and review/privacy URLs on organizations were added
-- directly in the Supabase dashboard, never captured by a migration. The
-- 'workshop' portal theme option was also enabled in prod without updating
-- the check constraint added in 20260504090000_org_theme.sql. Mirrors prod's
-- current organizations schema.

alter table public.organizations
  add column if not exists google_review_url text,
  add column if not exists privacy_policy_url text,
  add column if not exists data_retention_years smallint not null default 7,
  add column if not exists dpa_accepted_at timestamptz,
  add column if not exists dpa_accepted_by_user_id uuid,
  add column if not exists dpa_version text;

alter table public.organizations
  drop constraint if exists organizations_portal_theme_check;

alter table public.organizations
  add constraint organizations_portal_theme_check
    check (portal_theme in ('dark', 'light', 'glass', 'workshop'));
