-- Store the DVLA fuel type on the vehicle so the high-voltage job flag can be
-- set automatically (EV / hybrid) and we don't re-query DVLA every job. Null
-- until first looked up.
alter table public.vehicles
  add column if not exists fuel_type text;
