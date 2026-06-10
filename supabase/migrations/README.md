# Migrations

Date-prefixed (`YYYYMMDDHHMMSS_name.sql`), applied via the Supabase CLI.

## ⚠️ Known schema drift — baseline needed

The following tables are **referenced by code and altered by later migrations,
but no migration creates them** — they were created directly in the Supabase
dashboard. A fresh database built from this directory alone will fail partway
through the chain (the first `alter table public.invoices…` aborts):

`bays`, `bookings`, `data_deletion_log`, `fleet_companies`, `invoices`,
`job_items`, `jobs`, `products`, `scheduled_tasks`, `services`, `tyre_checks`,
`webauthn_credentials`

Consequences until a baseline lands:

- `supabase db reset` / local stack / CI against a clean database cannot work.
- Disaster recovery depends on Supabase backups, not on this repo.
- Index coverage on the hottest tables is not reviewable from the repo.

### How to capture the baseline (needs prod access)

```bash
supabase login
supabase link --project-ref <project-ref>   # ref = subdomain of SUPABASE_URL
supabase db diff -f baseline_dashboard_tables --linked
```

Review the generated file, keep only the missing `create table` /
`create index` / RLS statements, and date-prefix it **earlier than
`20260517100000_stripe_payments.sql`** (the first migration that alters a
dashboard-created table) so a fresh chain replays in order. Then mark it as
already applied on prod: `supabase migration repair --status applied <version>`.

## Conventions

- New tables ship with RLS policies using `is_org_member()` / `is_org_owner()`
  / `is_location_member()` (see CLAUDE.md).
- Functions callable only by the backend follow the `platform_db_health`
  pattern: `revoke all … from public, anon, authenticated; grant execute … to
  service_role`.
