-- Optional Stripe payment at the time of booking.
-- Adds the columns needed to link a booking to a Checkout Session + record
-- the resulting payment. A booking with no Stripe IDs is unpaid (existing
-- behaviour); a booking with a payment_intent + paid_at was prepaid at
-- booking time via the widget.

alter table public.bookings
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_amount_pence integer;

create index if not exists bookings_stripe_payment_intent_idx
  on public.bookings (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
