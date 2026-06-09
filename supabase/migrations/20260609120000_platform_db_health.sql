-- DB health probe for /admin/health (PR 5a). Returns only aggregate connection
-- counts (no row/session detail), so it's safe to expose to the service-role
-- client. SECURITY DEFINER so it can read pg_stat_activity / pg_settings.

create or replace function public.platform_db_health()
returns table (used int, max int, pct numeric)
language sql
security definer
set search_path = public, pg_catalog
as $body$
  select
    (select count(*)::int from pg_stat_activity)                                   as used,
    (select setting::int from pg_settings where name = 'max_connections')          as max,
    round(
      100.0 * (select count(*) from pg_stat_activity)
        / nullif((select setting::int from pg_settings where name = 'max_connections'), 0),
      1
    )                                                                              as pct;
$body$;

-- Platform-only: callable by the service-role client (createAdminClient); not by
-- tenants/anon.
revoke all on function public.platform_db_health() from public, anon, authenticated;
grant execute on function public.platform_db_health() to service_role;
