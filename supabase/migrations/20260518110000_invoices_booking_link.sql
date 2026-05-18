-- Link invoices back to the booking that generated them, so a booking
-- prepay flow can produce a paid invoice that the customer can find in
-- their portal alongside job invoices.

alter table public.invoices
  add column if not exists booking_id uuid references public.bookings(id) on delete set null;

create unique index if not exists invoices_booking_id_idx
  on public.invoices (booking_id)
  where booking_id is not null;
