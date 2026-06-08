-- Retired location slugs. When a platform admin renames a location's slug
-- (subdomain), the old slug is recorded here so that:
--   1. the old subdomain 308-redirects to the location's current subdomain
--      (so existing links/bookmarks keep working); and
--   2. the old slug is permanently reserved — it can never be reused by any
--      org or location (enforced in app code via findSlugConflict()).

create table if not exists public.location_slug_history (
  id              uuid primary key default uuid_generate_v4(),
  old_slug        text not null unique,
  location_id     uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists location_slug_history_location_idx
  on public.location_slug_history (location_id);

alter table public.location_slug_history enable row level security;

-- Reads happen via the service-role client (middleware redirect + uniqueness
-- checks), which bypasses RLS. Platform admins may also read it directly.
create policy "location_slug_history_admin_read"
  on public.location_slug_history for select
  using (public.is_platform_admin());
