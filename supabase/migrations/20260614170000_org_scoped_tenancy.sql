-- Org-scoped tenancy — PHASE 1 (EXPAND, non-breaking).
--
-- Goal: move the tenant boundary from location to organization. Until now the
-- subdomain slug resolved to a `locations` row and almost every table was
-- location-scoped, including `customers` (UNIQUE(location_id, email)) — so a
-- multi-branch business behaved like N disconnected tenants.
--
-- This migration is deliberately ADDITIVE and deployable on its own without any
-- app change:
--   * adds organization_id to the customer-global + financial tables and
--     backfills it from the existing location association;
--   * merges duplicate (organization_id, lower(email)) customers into one
--     (survivor = earliest created_at) and de-dupes vehicles by
--     (organization_id, registration) — re-pointing every child FK first;
--   * WIDENS the RLS read policies to the organization (a strict SUPERSET of the
--     old per-location access, so nothing loses access), adds the `accountant`
--     org role + an is_org_finance read path for the global money view;
--   * keeps customers.location_id and vehicles.location_id in place so the
--     current app keeps working. A later PHASE 2 (CONTRACT) migration renames
--     customers.location_id -> preferred_location_id and drops
--     vehicles.location_id once the app no longer reads them.
--
-- Pre-launch / low data: runs once inside the migration transaction. Verify on
-- a staging branch before prod (plan: 0 dup customers, FK counts conserved).

-- ── 1. New org role: accountant ─────────────────────────────────────────────
alter table public.org_users drop constraint if exists org_users_role_check;
alter table public.org_users
  add constraint org_users_role_check check (role in ('owner', 'admin', 'accountant'));

-- ── 2. RLS helpers ──────────────────────────────────────────────────────────
-- New: is_org_admin (owner|admin), is_org_finance (owner|admin|accountant —
-- finance reads), is_org_staff (anyone employed anywhere in the org —
-- customer-global reads). Revised: is_location_member now restricts its
-- org-wide grant to owner|admin so a future accountant gets NO operational
-- access (no-op for existing data: org_users only held owner|admin until now).
-- create-or-replace keeps the OID, so policies bound to is_location_member keep
-- working unchanged.

create or replace function private.is_org_admin(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $body$
  select private.is_platform_admin() or exists (
    select 1 from public.org_users
    where user_id = auth.uid() and organization_id = org_id and role in ('owner', 'admin')
  );
$body$;

create or replace function private.is_org_finance(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $body$
  select private.is_platform_admin() or exists (
    select 1 from public.org_users
    where user_id = auth.uid() and organization_id = org_id
      and role in ('owner', 'admin', 'accountant')
  );
$body$;

create or replace function private.is_org_staff(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $body$
  select private.is_platform_admin()
    or exists (
      select 1 from public.org_users
      where user_id = auth.uid() and organization_id = org_id
    )
    or exists (
      select 1
      from public.location_users lu
      join public.locations l on l.id = lu.location_id
      where lu.user_id = auth.uid() and l.organization_id = org_id
    );
$body$;

create or replace function private.is_location_member(loc_id uuid)
returns boolean language sql stable security definer set search_path = public as $body$
  select
    private.is_platform_admin()
    or exists (
      select 1 from public.location_users
      where user_id = auth.uid() and location_id = loc_id
    )
    or exists (
      select 1
      from public.locations l
      join public.org_users ou on ou.organization_id = l.organization_id
      where l.id = loc_id and ou.user_id = auth.uid() and ou.role in ('owner', 'admin')
    );
$body$;

grant execute on function private.is_org_admin(uuid) to authenticated;
grant execute on function private.is_org_finance(uuid) to authenticated;
grant execute on function private.is_org_staff(uuid) to authenticated;

-- ── 3. Add organization_id (+ customers.preferred_location_id) and backfill ──
-- location_id columns are intentionally kept (PHASE 2 contract removes/renames).
alter table public.customers add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
-- The assignable / changeable "home garage". Backfilled from current location;
-- the app reads this name going forward, the contract migration drops the old
-- location_id once nothing references it.
alter table public.customers add column if not exists preferred_location_id uuid references public.locations(id) on delete set null;

alter table public.vehicles add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.service_plans add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.plan_subscriptions add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.reminders add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.invoices add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.credit_notes add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

update public.customers c
  set organization_id = l.organization_id, preferred_location_id = coalesce(c.preferred_location_id, c.location_id)
  from public.locations l where l.id = c.location_id;
update public.vehicles v
  set organization_id = l.organization_id
  from public.locations l where l.id = v.location_id;
update public.service_plans s
  set organization_id = l.organization_id
  from public.locations l where l.id = s.location_id;
update public.plan_subscriptions p
  set organization_id = l.organization_id
  from public.locations l where l.id = p.location_id;
update public.reminders r
  set organization_id = l.organization_id
  from public.locations l where l.id = r.location_id;
update public.invoices i
  set organization_id = l.organization_id
  from public.locations l where l.id = i.location_id;
update public.credit_notes n
  set organization_id = l.organization_id
  from public.locations l where l.id = n.location_id;

-- ── 3b. Auto-fill organization_id from location_id on write ─────────────────
-- Keeps this migration non-breaking: the existing app (and cron/webhooks) still
-- insert these rows with only location_id set. A BEFORE INSERT/UPDATE trigger
-- derives organization_id from the row's location_id when it's null, so every
-- current insert path keeps working AND the NOT NULL below holds. (Customers
-- still have location_id in this expand phase; PHASE 2 switches the source
-- column to preferred_location_id when location_id is dropped.)
create or replace function private.set_org_from_location()
returns trigger language plpgsql security definer set search_path = public as $body$
begin
  if new.organization_id is null and new.location_id is not null then
    select organization_id into new.organization_id
    from public.locations where id = new.location_id;
  end if;
  return new;
end;
$body$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','vehicles','service_plans','plan_subscriptions','reminders','invoices','credit_notes'
  ] loop
    execute format('drop trigger if exists trg_%1$s_set_org on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_set_org before insert or update on public.%1$s '
      'for each row execute function private.set_org_from_location()', t
    );
  end loop;
end $$;

-- ── 4. Merge duplicate customers (one per org) ──────────────────────────────
-- Survivor = earliest created_at (tie-break: lowest id). Re-point EVERY child
-- FK to the survivor before deleting losers — generic loop over pg_constraint
-- so no referencing table is missed (all customer FKs are single-column). Four
-- of those FKs are ON DELETE CASCADE, so deleting a loser first would destroy
-- its vehicles/reminders/quotes — hence re-point, then delete.
create temporary table _cust_merge on commit drop as
with ranked as (
  select id,
    first_value(id) over (
      partition by organization_id, lower(email)
      order by created_at asc, id asc
    ) as survivor_id
  from public.customers
  where email is not null and email <> ''
)
select id as loser_id, survivor_id from ranked where id <> survivor_id;

do $$
declare fk record;
begin
  for fk in
    select con.conrelid::regclass as tbl, att.attname as col
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and con.confrelid = 'public.customers'::regclass
  loop
    execute format(
      'update %s t set %I = m.survivor_id from _cust_merge m where t.%I = m.loser_id',
      fk.tbl, fk.col, fk.col
    );
  end loop;
end $$;

delete from public.customers c using _cust_merge m where c.id = m.loser_id;

-- ── 5. De-dupe vehicles by (organization_id, registration) ──────────────────
create temporary table _veh_merge on commit drop as
with ranked as (
  select id,
    first_value(id) over (
      partition by organization_id, registration
      order by created_at asc, id asc
    ) as survivor_id
  from public.vehicles
)
select id as loser_id, survivor_id from ranked where id <> survivor_id;

do $$
declare fk record;
begin
  for fk in
    select con.conrelid::regclass as tbl, att.attname as col
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and con.confrelid = 'public.vehicles'::regclass
  loop
    execute format(
      'update %s t set %I = m.survivor_id from _veh_merge m where t.%I = m.loser_id',
      fk.tbl, fk.col, fk.col
    );
  end loop;
end $$;

delete from public.vehicles v using _veh_merge m where v.id = m.loser_id;

-- ── 6. Org-scoped uniqueness + NOT NULL ─────────────────────────────────────
-- New org-level uniqueness. The legacy per-location unique constraints are LEFT
-- in place (still satisfied — location_id is retained); the contract migration
-- drops them with the old column.
create unique index if not exists customers_org_email_key
  on public.customers (organization_id, lower(email)) where email is not null and email <> '';
create unique index if not exists vehicles_org_registration_key
  on public.vehicles (organization_id, registration);

alter table public.customers alter column organization_id set not null;
alter table public.vehicles alter column organization_id set not null;
alter table public.service_plans alter column organization_id set not null;
alter table public.plan_subscriptions alter column organization_id set not null;
alter table public.reminders alter column organization_id set not null;
alter table public.invoices alter column organization_id set not null;
alter table public.credit_notes alter column organization_id set not null;

-- ── 7. Widen RLS read to the organization (strict superset of old access) ────
-- customers / vehicles: any org staff (is_org_staff) + customer self. This is a
-- superset of the old is_location_member(location_id) grant, so no one loses
-- access; org staff at other branches now gain the intended global view.
drop policy if exists "customers_select" on public.customers;
drop policy if exists "customers_insert" on public.customers;
drop policy if exists "customers_update" on public.customers;
drop policy if exists "customers_delete" on public.customers;
create policy "customers_select" on public.customers for select to authenticated
  using (private.is_org_staff(organization_id) or user_id = (select auth.uid()));
create policy "customers_insert" on public.customers for insert to authenticated
  with check (private.is_org_staff(organization_id));
create policy "customers_update" on public.customers for update to authenticated
  using (private.is_org_staff(organization_id)) with check (private.is_org_staff(organization_id));
create policy "customers_delete" on public.customers for delete to authenticated
  using (private.is_org_staff(organization_id));

drop policy if exists "vehicles_select" on public.vehicles;
drop policy if exists "vehicles_insert" on public.vehicles;
drop policy if exists "vehicles_update" on public.vehicles;
drop policy if exists "vehicles_delete" on public.vehicles;
create policy "vehicles_select" on public.vehicles for select to authenticated
  using (
    private.is_org_staff(organization_id)
    or customer_id in (select id from public.customers where user_id = (select auth.uid()))
  );
create policy "vehicles_insert" on public.vehicles for insert to authenticated
  with check (private.is_org_staff(organization_id));
create policy "vehicles_update" on public.vehicles for update to authenticated
  using (private.is_org_staff(organization_id)) with check (private.is_org_staff(organization_id));
create policy "vehicles_delete" on public.vehicles for delete to authenticated
  using (private.is_org_staff(organization_id));

-- service_plans / plan_subscriptions / reminders: org-wide staff read.
drop policy if exists "service_plans_member_read" on public.service_plans;
create policy "service_plans_member_read" on public.service_plans for select to authenticated
  using (private.is_org_staff(organization_id));

drop policy if exists "plan_subscriptions_member_read" on public.plan_subscriptions;
create policy "plan_subscriptions_member_read" on public.plan_subscriptions for select to authenticated
  using (private.is_org_staff(organization_id));

drop policy if exists "reminders_member_all" on public.reminders;
create policy "reminders_member_read" on public.reminders for select to authenticated
  using (private.is_org_staff(organization_id));

-- invoices / credit_notes: branch members OR org finance (owner|admin|accountant).
drop policy if exists "invoices_member_read" on public.invoices;
create policy "invoices_member_read" on public.invoices for select to authenticated
  using (private.is_location_member(location_id) or private.is_org_finance(organization_id));

drop policy if exists "credit_notes_member_read" on public.credit_notes;
create policy "credit_notes_member_read" on public.credit_notes for select to authenticated
  using (private.is_location_member(location_id) or private.is_org_finance(organization_id));

-- ── 8. Indexes for the new org-scoped access paths ──────────────────────────
create index if not exists customers_org_idx on public.customers (organization_id);
create index if not exists customers_preferred_location_idx on public.customers (preferred_location_id);
create index if not exists vehicles_org_idx on public.vehicles (organization_id);
create index if not exists service_plans_org_idx on public.service_plans (organization_id, active);
create index if not exists plan_subscriptions_org_idx on public.plan_subscriptions (organization_id);
create index if not exists reminders_org_idx on public.reminders (organization_id);
create index if not exists invoices_org_status_idx on public.invoices (organization_id, status);
create index if not exists credit_notes_org_idx on public.credit_notes (organization_id);

-- FOLLOW-UPS (later PRs, not here):
--  * PHASE 2 (contract): rename customers.location_id -> preferred_location_id
--    drop, drop vehicles.location_id, drop legacy per-location unique constraints.
--  * Extend standalone_quotes & finance_applications SELECT policies with
--    `or private.is_org_finance(organization_id)` for the accountant.
