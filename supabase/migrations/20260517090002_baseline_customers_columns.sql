-- Part of the dashboard-tables baseline (see 20260517090000). These customers
-- columns (fleet accounts + GDPR marketing-consent/anonymisation tracking)
-- were added directly in the Supabase dashboard, never captured by a
-- migration. Mirrors prod's current customers schema.

alter table public.customers
  add column if not exists fleet_company_id uuid references public.fleet_companies(id) on delete set null,
  add column if not exists marketing_email_consent boolean not null default false,
  add column if not exists marketing_sms_consent boolean not null default false,
  add column if not exists consent_updated_at timestamptz,
  add column if not exists anonymized_at timestamptz;
