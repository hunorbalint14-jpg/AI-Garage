-- Bugfix: RLS evaluation errors with
--   "function public.is_platform_admin() does not exist"
-- on any RLS-enforced statement that evaluates is_org_member /
-- is_org_owner / is_location_member through the user's (non-service-role)
-- client. First seen adding a customer to a second location: customers are
-- unique per (location_id, email), so the same email at another location
-- passes the constraint and the INSERT's WITH CHECK runs is_location_member().
--
-- Cause: 20260607130000 defined these three helpers with bodies that call
-- `public.is_platform_admin()`. 20260612160000 then moved is_platform_admin()
-- (and the helpers) into the `private` schema with `alter function ... set
-- schema private`, which relocates the function but does NOT rewrite the
-- helper bodies — they still reference the old `public.is_platform_admin()`
-- name, which no longer resolves. Most app paths use the service-role client
-- (RLS bypassed), so this stayed latent until an RLS-enforced write hit it.
--
-- Fix: recreate the three helpers in `private` with the body calling
-- `private.is_platform_admin()`. create-or-replace keeps the same OID, so every
-- policy already bound to these functions keeps working unchanged.

create or replace function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select private.is_platform_admin() or exists (
    select 1 from public.org_users
    where user_id = auth.uid() and organization_id = org_id
  );
$body$;

create or replace function private.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select private.is_platform_admin() or exists (
    select 1 from public.org_users
    where user_id = auth.uid() and organization_id = org_id and role = 'owner'
  );
$body$;

create or replace function private.is_location_member(loc_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $body$
  select
    private.is_platform_admin()
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

-- create-or-replace preserves grants, but re-assert them so authenticated can
-- evaluate the helpers during RLS (they run as the querying role).
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_owner(uuid) to authenticated;
grant execute on function private.is_location_member(uuid) to authenticated;
