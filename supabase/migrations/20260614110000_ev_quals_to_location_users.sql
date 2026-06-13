-- Move per-technician EV qualifications onto location_users, alongside the
-- mot_tester / mot_qc_reviewer flags — they're the same shape (a per-member,
-- per-location professional certification) and belong on the same edit panel
-- in the Team page rather than a separate page. Backfill anything in the
-- short-lived staff_ev_quals table (added the same day in 20260614100000),
-- then drop it.

alter table public.location_users
  add column if not exists ev_level smallint check (ev_level between 1 and 4),
  add column if not exists ev_certified_at date,
  add column if not exists ev_expires_at date;

update public.location_users lu
   set ev_level = q.level,
       ev_certified_at = q.certified_at,
       ev_expires_at = q.expires_at
  from public.staff_ev_quals q
 where q.location_id = lu.location_id
   and q.user_id = lu.user_id;

drop table if exists public.staff_ev_quals;
