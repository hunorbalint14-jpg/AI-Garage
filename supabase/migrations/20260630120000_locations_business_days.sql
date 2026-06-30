-- Operational/opening days per branch (staff settings → Booking tab). Pairs
-- with the existing business_hours_start/end columns. Stored as JS getDay()
-- weekday numbers (0=Sun .. 6=Sat); default Mon–Sat ({1,2,3,4,5,6}), the most
-- common UK garage week. Drives the public booking widget (rejects closed-day
-- requests), the AI receptionist, and the staff bookings calendar.

alter table public.locations
  add column if not exists business_days smallint[] not null default '{1,2,3,4,5,6}';
