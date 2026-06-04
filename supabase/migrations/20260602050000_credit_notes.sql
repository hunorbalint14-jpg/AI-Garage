-- Credit notes (Phase 5 PR2). One row per refund against an invoice — whether
-- a Stripe refund of an online payment or a recorded cash refund. The unique
-- stripe_refund_id makes the staff-action path and the charge.refunded webhook
-- idempotent (neither double-records the same Stripe refund). Invoice status
-- moves to part_refunded / refunded as credit notes accumulate.

create table if not exists public.credit_notes (
  id                 uuid primary key default uuid_generate_v4(),
  location_id        uuid not null references public.locations(id) on delete cascade,
  invoice_id         uuid references public.invoices(id) on delete set null,
  customer_id        uuid references public.customers(id) on delete set null,
  credit_number      text,
  reason             text,
  subtotal           numeric not null default 0,
  vat_amount         numeric not null default 0,
  total              numeric not null default 0,
  status             text not null default 'issued' check (status in ('issued', 'synced')),
  stripe_refund_id   text unique,
  xero_credit_note_id text,
  created_by         uuid,
  created_at         timestamptz not null default now()
);

create index if not exists credit_notes_location_idx on public.credit_notes (location_id);
create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);

alter table public.credit_notes enable row level security;
create policy "credit_notes_member_read"
  on public.credit_notes for select using (public.is_location_member(location_id));
