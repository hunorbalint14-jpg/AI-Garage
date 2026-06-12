-- Clears the residual 0029 advisor warning on the is_* RLS helpers. They must
-- stay executable by authenticated (policies evaluate them as the querying
-- role), but they don't need to live in the API-exposed public schema —
-- PostgREST only serves /rest/v1/rpc for exposed schemas, so relocating them
-- removes the RPC endpoint entirely.
--
-- Safe move: policies bind functions by OID, not name, so every existing
-- policy keeps working and re-renders as private.is_*. NEW policies must
-- reference private.is_location_member() etc. from now on.

create schema if not exists private;
-- authenticated executes the helpers during policy evaluation → needs USAGE.
grant usage on schema private to authenticated;

alter function public.is_location_member(uuid) set schema private;
alter function public.is_org_member(uuid) set schema private;
alter function public.is_org_owner(uuid) set schema private;
alter function public.is_platform_admin() set schema private;
