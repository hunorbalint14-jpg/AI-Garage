-- Supplier connectivity (#568, epic #499, docs/parts-catalogue-build-spec.md PR 3).
-- One integration row per supplier describing HOW we order from them. The
-- launch connector is 'manual' (punch-out deep link + structured order email);
-- trade-API connectors (GSF / Euro Car Parts / Alliance) slot in behind the
-- same SupplierConnector interface as new `kind` values, without touching the
-- purchase-order or job screens. See docs/supplier-connectivity-spike.md.

create table if not exists public.supplier_integrations (
  id                    uuid primary key default gen_random_uuid(),
  supplier_id           uuid not null unique references public.suppliers(id) on delete cascade,
  location_id           uuid not null references public.locations(id) on delete cascade,
  organization_id       uuid references public.organizations(id) on delete cascade,
  kind                  text not null default 'manual' check (kind in ('manual')),
  enabled               boolean not null default true,
  -- Punch-out: the supplier's own catalogue URL, with {reg} / {query}
  -- placeholders substituted at click time (src/lib/suppliers/punchout.ts).
  punchout_url_template text,
  -- Where structured order emails go. Falls back to suppliers.contact_email.
  order_email           text,
  -- Our trade account number, printed on the order so the factor can price it.
  account_number        text,
  -- AES-GCM app-layer encrypted JSON (src/lib/encryption.ts) — API credentials
  -- for the trade-API connectors. Never read by the browser: written by the
  -- settings action, read only by server code through the admin client.
  credentials           text,
  settings              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists supplier_integrations_location_idx
  on public.supplier_integrations (location_id, enabled);

create trigger set_org_from_location
  before insert on public.supplier_integrations
  for each row execute function private.set_org_from_location();

alter table public.supplier_integrations enable row level security;

-- Credentials live here — service role only, same posture as
-- accounting_connections. Staff-facing status ("credentials set: yes/no")
-- is read in server code through the admin client and never exposes values.
create policy "supplier_integrations_service_only" on public.supplier_integrations
  for all using (false) with check (false);

grant all on public.supplier_integrations to service_role;

-- Purchase orders gain the supplier-order round trip: what we sent and how,
-- the supplier's own order reference, and when their confirmation was
-- imported. The raw confirmation text is kept so a mis-parse can be re-read.
alter table public.purchase_orders
  add column if not exists sent_at                  timestamptz,
  add column if not exists sent_channel             text
    check (sent_channel is null or sent_channel in ('email', 'punchout')),
  add column if not exists supplier_order_ref       text,
  add column if not exists confirmation_imported_at timestamptz,
  add column if not exists confirmation_raw         text;
