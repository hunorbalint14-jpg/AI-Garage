-- eVHC Phase 5 (#497): view counter for the customer report page, same
-- pattern as quotes_increment_view. Service-role only — the /check/[slug]
-- page calls it server-side after the token check.

create or replace function public.inspections_increment_view(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.inspections
  set viewed_count = viewed_count + 1,
      viewed_at = coalesce(viewed_at, now())
  where id = p_id
    and status = 'sent';
$$;

revoke all on function public.inspections_increment_view(uuid) from public, anon, authenticated;
grant execute on function public.inspections_increment_view(uuid) to service_role;
