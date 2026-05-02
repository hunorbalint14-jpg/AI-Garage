-- Test seed data for local development.
-- Insert a sample garage so the tenant subdomain renders.

insert into public.garages (slug, name, primary_color)
values
  ('smith-motors', 'Smith Motors', '#dc2626'),
  ('green-auto', 'Green Auto Centre', '#15803d')
on conflict (slug) do nothing;
