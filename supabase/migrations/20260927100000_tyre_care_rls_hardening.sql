-- Tyre-care RLS hardening (#596 follow-up to 20260730100000).
-- wheel_service_events_member_all WITH CHECK only validated that the caller
-- belongs to location_id — vehicle_id went unchecked. Any authenticated branch
-- member could POST a row through PostgREST attaching their own branch to
-- ANOTHER organisation's vehicle, which then surfaces on that org's vehicle
-- page (the table is readable org-wide by design) and feeds its cooldown
-- rules. The app's own write path already checks vehicle ownership in
-- addWheelServiceEvent; this closes the direct-API route.

-- SECURITY DEFINER so the check reads vehicles without tripping its own RLS,
-- matching private.is_location_member / private.is_org_staff. Parameters are
-- named veh_id/loc_id, not vehicle_id/location_id, so they cannot shadow the
-- policy row's own columns when this is called from a WITH CHECK.
create or replace function private.vehicle_in_location_org(veh_id uuid, loc_id uuid)
returns boolean language sql stable security definer set search_path = public as $body$
  select exists (
    select 1
    from public.vehicles v, public.locations l
    where v.id = veh_id
      and l.id = loc_id
      and v.organization_id = l.organization_id
  );
$body$;

grant execute on function private.vehicle_in_location_org(uuid, uuid) to authenticated;

drop policy if exists "wheel_service_events_member_all" on public.wheel_service_events;

create policy "wheel_service_events_member_all" on public.wheel_service_events
  for all to authenticated
  using (private.is_location_member(location_id))
  with check (
    private.is_location_member(location_id)
    and private.vehicle_in_location_org(vehicle_id, location_id)
  );
