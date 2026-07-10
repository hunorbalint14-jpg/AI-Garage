-- Demo sandbox (#506 PR 3): flag on the six row families the seeder creates.
-- The flag drives badges, the wipe, and exclusions (comms, activation, Xero);
-- RLS is unchanged — demo rows are ordinary org rows.
alter table public.customers add column if not exists is_demo boolean not null default false;
alter table public.vehicles  add column if not exists is_demo boolean not null default false;
alter table public.bookings  add column if not exists is_demo boolean not null default false;
alter table public.jobs      add column if not exists is_demo boolean not null default false;
alter table public.invoices  add column if not exists is_demo boolean not null default false;
alter table public.quotes    add column if not exists is_demo boolean not null default false;
