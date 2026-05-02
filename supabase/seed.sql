-- Test seed data for local development.
-- Inserts two sample organizations, each with a single default location,
-- so the tenant subdomain renders.

insert into public.organizations (slug, name, primary_color)
values
  ('smith-motors', 'Smith Motors', '#dc2626'),
  ('green-auto', 'Green Auto Centre', '#15803d')
on conflict (slug) do nothing;

insert into public.locations (organization_id, slug, name)
select id, slug, name
from public.organizations
where slug in ('smith-motors', 'green-auto')
on conflict (slug) do nothing;
