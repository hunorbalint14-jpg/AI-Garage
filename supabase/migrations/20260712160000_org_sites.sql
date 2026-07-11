-- Garage mini-site (#507 PR 2): one settings row per org. The page itself is
-- public — anon may read PUBLISHED rows only. Writes stay admin-client.
create table if not exists public.org_sites (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  published       boolean not null default false,
  -- Fixed-order sections; each key toggleable. Absent key = shown.
  sections        jsonb not null default '{}'::jsonb,
  strapline       text,
  about           text,
  gallery_paths   text[] not null default '{}',
  updated_at      timestamptz not null default now()
);

alter table public.org_sites enable row level security;

grant select on public.org_sites to anon, authenticated;
grant all on public.org_sites to service_role;

drop policy if exists "org_sites_public_read" on public.org_sites;
create policy "org_sites_public_read" on public.org_sites
  for select to anon, authenticated
  using (published = true);

drop policy if exists "org_sites_staff_read" on public.org_sites;
create policy "org_sites_staff_read" on public.org_sites
  for select to authenticated
  using (private.is_org_staff(organization_id));
