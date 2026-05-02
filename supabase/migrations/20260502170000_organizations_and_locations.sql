-- Multi-location refactor: introduce organizations as the parent of locations.
-- Existing garages each become a single-location organization; existing
-- 'owner' garage_users get promoted to org-level owners.
--
-- Run this once against your Supabase project. It is idempotent w.r.t. orgs
-- (creates one per existing garage) and preserves all customer/vehicle data.

-- 1. organizations (the parent business: brand, billing, owners)
create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  name text not null,
  primary_color text not null default '#1f2937',
  logo_url text,
  custom_domain text unique,
  created_at timestamptz not null default now()
);

-- 2. org_users (owner/admin level access across all locations in the org)
create table public.org_users (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now(),
  unique (user_id, organization_id)
);

-- 3. Rename garages -> locations
alter table public.garages rename to locations;

-- 4. Add organization_id to locations (nullable for backfill)
alter table public.locations add column organization_id uuid references public.organizations(id) on delete cascade;

-- 5. Backfill: one organization per existing location, copying branding
with backfill as (
  insert into public.organizations (slug, name, primary_color, logo_url, custom_domain)
  select slug, name, primary_color, logo_url, custom_domain from public.locations
  returning id, slug
)
update public.locations as l
set organization_id = b.id
from backfill as b
where l.slug = b.slug;

-- 6. Make organization_id required and drop branding columns from locations
--    (branding lives on organizations now)
alter table public.locations alter column organization_id set not null;
alter table public.locations drop column primary_color;
alter table public.locations drop column logo_url;
alter table public.locations drop column custom_domain;

-- 7. Rename garage_users -> location_users, garage_id -> location_id
alter table public.garage_users rename to location_users;
alter table public.location_users rename column garage_id to location_id;

-- 8. Promote 'owner' role from location_users up to org_users
insert into public.org_users (user_id, organization_id, role)
select lu.user_id, l.organization_id, 'owner'
from public.location_users lu
join public.locations l on l.id = lu.location_id
where lu.role = 'owner'
on conflict (user_id, organization_id) do nothing;

delete from public.location_users where role = 'owner';

-- 9. location_users.role: drop the 'owner' option (now org-level only)
alter table public.location_users drop constraint if exists garage_users_role_check;
alter table public.location_users add constraint location_users_role_check
  check (role in ('manager', 'staff'));

-- 10. Rename garage_id -> location_id on customers and vehicles
alter table public.customers rename column garage_id to location_id;
alter table public.vehicles rename column garage_id to location_id;

-- 11. RLS helpers — drop old, add new
drop function if exists public.is_garage_staff(uuid);

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select exists (
    select 1 from public.org_users
    where user_id = auth.uid() and organization_id = org_id
  );
$body$;

create or replace function public.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select exists (
    select 1 from public.org_users
    where user_id = auth.uid() and organization_id = org_id and role = 'owner'
  );
$body$;

create or replace function public.is_location_member(loc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select
    exists (
      select 1 from public.location_users
      where user_id = auth.uid() and location_id = loc_id
    )
    or exists (
      select 1
      from public.locations l
      join public.org_users ou on ou.organization_id = l.organization_id
      where l.id = loc_id and ou.user_id = auth.uid()
    );
$body$;

-- 12. Enable RLS on the two new tables
alter table public.organizations enable row level security;
alter table public.org_users enable row level security;

-- 13. Refresh policies: locations + organizations
drop policy if exists "garages_select_public" on public.locations;
drop policy if exists "garages_update_owner" on public.locations;

create policy "organizations_select_public"
  on public.organizations for select using (true);

create policy "organizations_update_owner"
  on public.organizations for update
  using (public.is_org_owner(id));

create policy "locations_select_member"
  on public.locations for select
  using (public.is_location_member(id) or public.is_org_member(organization_id));

create policy "locations_update_org_owner"
  on public.locations for update
  using (public.is_org_owner(organization_id));

create policy "locations_insert_org_owner"
  on public.locations for insert
  with check (public.is_org_owner(organization_id));

-- 14. org_users policies
create policy "org_users_select_self"
  on public.org_users for select
  using (user_id = auth.uid());

create policy "org_users_select_same_org"
  on public.org_users for select
  using (public.is_org_member(organization_id));

create policy "org_users_owner_manage"
  on public.org_users for all
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

-- 15. location_users policies (refresh)
drop policy if exists "garage_users_select_self" on public.location_users;
drop policy if exists "garage_users_select_same_garage" on public.location_users;
drop policy if exists "garage_users_owner_manage" on public.location_users;

create policy "location_users_select_self"
  on public.location_users for select
  using (user_id = auth.uid());

create policy "location_users_select_same_location"
  on public.location_users for select
  using (public.is_location_member(location_id));

create policy "location_users_org_owner_manage"
  on public.location_users for all
  using (
    exists (
      select 1
      from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  );

-- 16. customers + vehicles policies (refresh to use new helper)
drop policy if exists "customers_staff_all" on public.customers;
drop policy if exists "customers_select_self" on public.customers;

create policy "customers_member_all"
  on public.customers for all
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));

create policy "customers_select_self"
  on public.customers for select
  using (user_id = auth.uid());

drop policy if exists "vehicles_staff_all" on public.vehicles;
drop policy if exists "vehicles_select_own" on public.vehicles;

create policy "vehicles_member_all"
  on public.vehicles for all
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));

create policy "vehicles_select_own"
  on public.vehicles for select
  using (
    customer_id in (select id from public.customers where user_id = auth.uid())
  );

-- 17. Helpful indexes for the new FKs and lookups
create index if not exists locations_organization_idx on public.locations (organization_id);
create index if not exists org_users_user_idx on public.org_users (user_id);
create index if not exists org_users_org_idx on public.org_users (organization_id);
