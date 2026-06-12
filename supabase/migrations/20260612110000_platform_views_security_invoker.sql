-- Supabase security advisory: views default to SECURITY DEFINER semantics in
-- Postgres — they run with the view owner's privileges, bypassing RLS on the
-- underlying tables. Combined with Supabase's default PostgREST grants, that
-- exposed the cross-tenant platform rollups (org names, slugs, uptime) to any
-- anon/authenticated API request.
--
-- platform_tenant_health never set security_invoker; platform_org_overview
-- had it in 20260607120000 but prod's copy lost the option (schema drift).
-- Both are queried only by the service-role admin client (BYPASSRLS), so
-- flipping to invoker semantics and revoking the API roles breaks nothing.

alter view public.platform_tenant_health set (security_invoker = true);
alter view public.platform_org_overview set (security_invoker = true);

-- Defense in depth: these are platform-operator views; the anon and
-- authenticated PostgREST roles have no business selecting them at all.
revoke select on public.platform_tenant_health from anon, authenticated;
revoke select on public.platform_org_overview from anon, authenticated;
