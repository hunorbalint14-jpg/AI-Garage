-- Row-Level Security: enforce tenant isolation across garages.
-- Customers can read their own data; staff can manage everything within their garage.

create or replace function public.is_garage_staff(g_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.garage_users
    where user_id = auth.uid() and garage_id = g_id
  );
$$;

alter table public.garages enable row level security;
alter table public.garage_users enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;

-- Garages: branding is public (needed to render the tenant subdomain before login).
-- All columns are intended for public display.
create policy "garages_select_public"
  on public.garages for select
  using (true);

create policy "garages_update_owner"
  on public.garages for update
  using (
    exists (
      select 1 from public.garage_users
      where user_id = auth.uid() and garage_id = id and role = 'owner'
    )
  );

-- Garage users: see own memberships and fellow staff in the same garage.
create policy "garage_users_select_self"
  on public.garage_users for select
  using (user_id = auth.uid());

create policy "garage_users_select_same_garage"
  on public.garage_users for select
  using (public.is_garage_staff(garage_id));

create policy "garage_users_owner_manage"
  on public.garage_users for all
  using (
    exists (
      select 1 from public.garage_users gu
      where gu.user_id = auth.uid() and gu.garage_id = garage_users.garage_id and gu.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.garage_users gu
      where gu.user_id = auth.uid() and gu.garage_id = garage_users.garage_id and gu.role = 'owner'
    )
  );

-- Customers: staff manage all customers in their garage; customers can read their own record.
create policy "customers_staff_all"
  on public.customers for all
  using (public.is_garage_staff(garage_id))
  with check (public.is_garage_staff(garage_id));

create policy "customers_select_self"
  on public.customers for select
  using (user_id = auth.uid());

-- Vehicles: staff manage all vehicles in their garage; customer can read their own vehicles.
create policy "vehicles_staff_all"
  on public.vehicles for all
  using (public.is_garage_staff(garage_id))
  with check (public.is_garage_staff(garage_id));

create policy "vehicles_select_own"
  on public.vehicles for select
  using (
    customer_id in (select id from public.customers where user_id = auth.uid())
  );
