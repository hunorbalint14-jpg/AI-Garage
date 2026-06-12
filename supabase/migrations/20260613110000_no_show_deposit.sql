-- No-show defence phase 2: card-on-file via Stripe SetupIntents (Tier 2
-- roadmap). At booking time (when the service isn't prepaid) the customer is
-- offered a card-save step on the garage's connected account, with clear
-- disclosure of the fee. Staff marking a booking no-show can then charge the
-- configured fee off-session. Charging is always a manual staff decision —
-- never automatic.

alter table public.organizations
  -- 0 = card-on-file disabled.
  add column if not exists no_show_fee_pence integer not null default 0;

alter table public.bookings
  -- Stamped by the stripe webhook when the setup-mode checkout completes.
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_setup_intent_id text,
  add column if not exists card_payment_method_id text,
  add column if not exists card_on_file_at timestamptz,
  -- Stamped when staff charge the fee (or the attempt fails).
  add column if not exists no_show_charge_intent_id text,
  add column if not exists no_show_charged_at timestamptz,
  add column if not exists no_show_charge_amount_pence integer,
  add column if not exists no_show_charge_error text;
