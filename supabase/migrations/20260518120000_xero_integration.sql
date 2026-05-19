-- Xero integration: per-organization OAuth connection + foreign-key
-- columns linking AI Garage invoices and customers to their Xero
-- counterparts. Tokens stored on organizations are only readable via the
-- service role (RLS denies anon/authenticated read).

alter table public.organizations
  add column if not exists xero_tenant_id text,
  add column if not exists xero_tenant_name text,
  add column if not exists xero_access_token text,
  add column if not exists xero_refresh_token text,
  add column if not exists xero_token_expires_at timestamptz,
  add column if not exists xero_connected_at timestamptz;

alter table public.invoices
  add column if not exists xero_invoice_id text,
  add column if not exists xero_synced_at timestamptz,
  add column if not exists xero_payment_id text;

alter table public.customers
  add column if not exists xero_contact_id text;

create index if not exists invoices_xero_invoice_idx
  on public.invoices (xero_invoice_id)
  where xero_invoice_id is not null;

create index if not exists customers_xero_contact_idx
  on public.customers (xero_contact_id)
  where xero_contact_id is not null;
