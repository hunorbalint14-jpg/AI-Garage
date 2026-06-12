-- Supabase advisories 0028/0029 (anon/authenticated can execute SECURITY
-- DEFINER functions via /rest/v1/rpc). Audit of every caller in src/ shows
-- all of these are invoked exclusively through the service-role admin client
-- (including the public /status page), so the PostgREST API roles don't need
-- EXECUTE on any of them.
--
-- Exception: the four is_* RLS helpers run inside policy expressions AS THE
-- QUERYING ROLE, so authenticated must keep EXECUTE or every staff/customer
-- query fails with "permission denied for function". anon loses it — anon
-- has no legitimate RLS-gated reads (all anon-facing flows are server-side
-- on the admin client), so an anon REST probe now errors instead of
-- evaluating policies.

-- Definer functions only ever called by the admin client -----------------------
revoke execute on function public.doc_shares_increment_view(uuid) from public, anon, authenticated;
revoke execute on function public.job_quotes_increment_view(uuid) from public, anon, authenticated;
revoke execute on function public.standalone_quotes_increment_view(uuid) from public, anon, authenticated;
revoke execute on function public.rollup_uptime_hour(timestamptz) from public, anon, authenticated;
-- granted to anon/authenticated by 20260609100000, but the /status page reads
-- it server-side via the admin client — the API-role grant was never used
revoke execute on function public.public_status_incidents() from public, anon, authenticated;
-- event-trigger function; fired by DDL events, never callable as RPC anyway.
-- Exists only on prod (dashboard-created, never migrated) — guarded so the
-- migration also replays on a from-scratch database.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- RLS helpers: keep authenticated (required inside policy evaluation),
-- drop anon + the default PUBLIC grant
revoke execute on function public.is_location_member(uuid) from public, anon;
revoke execute on function public.is_org_member(uuid) from public, anon;
revoke execute on function public.is_org_owner(uuid) from public, anon;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_location_member(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
