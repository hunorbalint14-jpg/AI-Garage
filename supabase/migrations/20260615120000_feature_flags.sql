-- Platform-wide feature flags, toggled from the admin dashboard
-- (admin.<root>/admin/feature-flags).
--
-- Flags are GLOBAL (one row per flag key, not per-tenant): a platform operator
-- flips a capability on/off for the whole estate. The app reads them via the
-- service-role client (cached in Redis, short TTL) and falls open to a
-- code-defined default when a row is missing — see src/lib/feature-flags.ts. The
-- registry there is the source of truth for which keys exist; this table only
-- stores the on/off override + audit trail.

create table if not exists public.feature_flags (
  key        text primary key,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.feature_flags enable row level security;

-- Writes go through the service-role client (the admin server action, which adds
-- auth + audit), which bypasses RLS. Platform admins may also read directly;
-- anon/authenticated PostgREST roles have no business touching it.
drop policy if exists "feature_flags_admin_read" on public.feature_flags;
create policy "feature_flags_admin_read"
  on public.feature_flags for select
  to authenticated
  using (private.is_platform_admin());

-- Seed the known flags so they're visible in a direct DB view; the admin UI
-- lists the code registry regardless, so missing rows are harmless.
insert into public.feature_flags (key, enabled) values
  ('streaming_dashboard', false)
on conflict (key) do nothing;
