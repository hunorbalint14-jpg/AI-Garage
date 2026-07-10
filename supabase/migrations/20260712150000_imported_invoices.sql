-- Migration toolkit (#505 PR 3): invoices brought over from the previous
-- system. Read-only historical documents — deliberately NOT public.invoices,
-- so numbering, VAT, revenue, dunning, Xero and the payments ledger can never
-- see them.
create table if not exists public.imported_invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  invoice_number  text not null,
  issued_on       date not null,
  total           numeric(10,2) not null,
  status          text,
  description     text,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists imported_invoices_customer_idx on public.imported_invoices (customer_id, issued_on desc);
create index if not exists imported_invoices_batch_idx on public.imported_invoices (import_batch_id);

alter table public.imported_invoices enable row level security;

drop policy if exists "imported_invoices_select" on public.imported_invoices;
create policy "imported_invoices_select" on public.imported_invoices
  for select to authenticated
  using (private.is_org_staff(organization_id));

-- The batches check constraint gains the new kind.
alter table public.import_batches drop constraint if exists import_batches_kind_check;
alter table public.import_batches
  add constraint import_batches_kind_check check (kind in ('customers', 'history', 'reminders', 'invoices'));
