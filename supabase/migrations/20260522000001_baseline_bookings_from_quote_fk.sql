-- Part of the dashboard-tables baseline (see 20260517090000). bookings.from_quote_id
-- can't reference job_quotes inline in the baseline migration because job_quotes
-- is created by this same migration's predecessor (20260522000000_job_quotes.sql).
-- Mirrors prod's existing bookings_from_quote_id_fkey constraint.

alter table public.bookings
  add constraint bookings_from_quote_id_fkey
  foreign key (from_quote_id) references public.job_quotes(id) on delete set null;
