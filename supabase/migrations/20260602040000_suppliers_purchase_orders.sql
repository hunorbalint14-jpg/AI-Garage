-- Suppliers + purchase orders (Phase 4 PR2). Lets a garage record who they buy
-- from and raise POs; receiving a PO replenishes product stock. All location-
-- scoped; reads via RLS member policy, writes via staff-context-checked actions
-- on the admin client.

create table if not exists public.suppliers (
  id            uuid primary key default uuid_generate_v4(),
  location_id   uuid not null references public.locations(id) on delete cascade,
  name          text not null,
  contact_email text,
  contact_phone text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists suppliers_location_idx on public.suppliers (location_id);
alter table public.suppliers enable row level security;
create policy "suppliers_member_read"
  on public.suppliers for select using (public.is_location_member(location_id));

create table if not exists public.purchase_orders (
  id            uuid primary key default uuid_generate_v4(),
  location_id   uuid not null references public.locations(id) on delete cascade,
  supplier_id   uuid references public.suppliers(id) on delete set null,
  reference     text,
  status        text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  notes         text,
  created_by    uuid,
  ordered_at    timestamptz,
  received_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists purchase_orders_location_idx on public.purchase_orders (location_id, status);
alter table public.purchase_orders enable row level security;
create policy "purchase_orders_member_read"
  on public.purchase_orders for select using (public.is_location_member(location_id));

create table if not exists public.purchase_order_items (
  id                uuid primary key default uuid_generate_v4(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id        uuid references public.products(id) on delete set null,
  description       text not null,
  quantity          numeric not null default 1,
  unit_cost         numeric not null default 0,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id);
alter table public.purchase_order_items enable row level security;
create policy "purchase_order_items_member_read"
  on public.purchase_order_items for select using (
    exists (
      select 1 from public.purchase_orders po
      where po.id = purchase_order_id and public.is_location_member(po.location_id)
    )
  );
