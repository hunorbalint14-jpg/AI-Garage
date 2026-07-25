-- Test seed data for local development.
-- Inserts two sample organizations, each with a single default location,
-- so the tenant subdomain renders.

insert into public.organizations (slug, name, primary_color)
values
  ('smith-motors', 'Smith Motors', '#dc2626'),
  ('green-auto', 'Green Auto Centre', '#15803d')
on conflict (slug) do nothing;

-- live_at: the base dev tenants are LIVE so local behaviour matches production.
-- Real new branches start prelive (null) — see 20260725120000_prelive_locations.
insert into public.locations (organization_id, slug, name, live_at)
select id, slug, name, now()
from public.organizations
where slug in ('smith-motors', 'green-auto')
on conflict (slug) do nothing;
