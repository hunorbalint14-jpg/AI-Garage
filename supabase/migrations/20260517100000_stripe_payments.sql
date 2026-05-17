-- Stripe Connect Express + invoice pay links.
-- Adds the columns required to track each garage's Stripe account and the
-- payment session/intent attached to a given invoice.

alter table public.organizations
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;

create unique index if not exists organizations_stripe_account_idx
  on public.organizations (stripe_account_id)
  where stripe_account_id is not null;

alter table public.invoices
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_paid_at timestamptz,
  add column if not exists stripe_paid_amount_pence integer;

create index if not exists invoices_stripe_payment_intent_idx
  on public.invoices (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
