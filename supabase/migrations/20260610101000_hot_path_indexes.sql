-- Composite indexes for the hottest per-location query shapes. Every staff
-- page filters by location_id first, so the legacy single-column indexes
-- (inherited from the garage_id renames) leave the planner scanning all of a
-- location's rows for date/status predicates.
--
-- Shapes served:
--   bookings  (location_id, scheduled_at)  dashboard today-window; bookings list
--   invoices  (location_id, status)        dashboard open invoices; invoices list
--   invoices  (location_id, paid_at)       revenue_stats month/YTD sums (paid only)
--   jobs      (location_id, status)        dashboard active-jobs count; revenue page
--   vehicles  (location_id, mot_expiry)    attention queue + reminder cron window
--   vehicles  (location_id, service_due)   (OR across the two → planner BitmapOr)
--   reminders (vehicle_id, type, channel)  reminder-cron dedup ("already sent?")

create index if not exists bookings_location_scheduled_idx
  on public.bookings (location_id, scheduled_at);

create index if not exists invoices_location_status_idx
  on public.invoices (location_id, status);

create index if not exists invoices_location_paid_at_idx
  on public.invoices (location_id, paid_at)
  where status = 'paid';

create index if not exists jobs_location_status_idx
  on public.jobs (location_id, status);

create index if not exists vehicles_location_mot_idx
  on public.vehicles (location_id, mot_expiry);

create index if not exists vehicles_location_service_idx
  on public.vehicles (location_id, service_due);

create index if not exists reminders_vehicle_dedup_idx
  on public.reminders (vehicle_id, type, channel, sent_at desc)
  where status = 'sent';
