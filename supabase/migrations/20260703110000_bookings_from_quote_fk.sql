-- Phase 7 (#255): bookings.from_quote_id still referenced the LEGACY
-- job_quotes table — missed in the Phase 2 cutover to the unified quotes
-- table. Since the cutover, any insert carrying from_quote_id for a new
-- (unified) quote violated the FK; the booking-widget rebook flow silently
-- retried without it (losing the linkage), and quote→booking conversion
-- would fail outright. Re-point the FK at public.quotes.

-- Null out any values that don't resolve in the unified table (legacy rows
-- were migrated with their ids preserved, so normally none).
update public.bookings b
set from_quote_id = null
where from_quote_id is not null
  and not exists (select 1 from public.quotes q where q.id = b.from_quote_id);

alter table public.bookings drop constraint if exists bookings_from_quote_id_fkey;
alter table public.bookings
  add constraint bookings_from_quote_id_fkey
  foreign key (from_quote_id) references public.quotes(id) on delete set null;
