-- Platform admins: invited operator accounts that (a) reach the admin.<root>
-- dashboard and (b) act as an owner inside EVERY tenant's staff portal.
--
-- The env allowlist (PLATFORM_ADMIN_EMAILS) remains a bootstrap; this table is
-- the authoritative source going forward and is what invited admins land in.
--
-- SECURITY NOTE: the three membership helpers below are used by RLS policies on
-- almost every table. Granting `is_platform_admin()` through them gives a
-- platform admin full read+write on all tenants' data. This is intentional
-- (oversight + support), gated by the invite flow, and audited on portal entry.

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

-- Is the current request from a platform admin? SECURITY DEFINER so it can read
-- platform_admins regardless of the caller's RLS (the function owner owns the
-- table and is exempt from RLS — same pattern as is_org_member, no recursion).
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$body$;

-- A platform admin can see the roster (to manage peers). All writes happen via
-- the service-role client (invite/revoke actions), which bypasses RLS.
create policy "platform_admins_read"
  on public.platform_admins for select
  using (public.is_platform_admin());

-- ── Extend the shared membership helpers: a platform admin passes them all ──
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select public.is_platform_admin() or exists (
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
  select public.is_platform_admin() or exists (
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
    public.is_platform_admin()
    or exists (
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
