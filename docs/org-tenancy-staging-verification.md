# Org-scoped tenancy — staging verification & RLS proof (#344)

Verification gate for the org-scoped tenancy migrations. **Do not run on prod
until this passes on a staging branch with prod-like data.**

The move from a **location**-scoped tenant boundary to an **organization**-scoped
one ships in three migrations plus the app changes that stop reading/writing
`customers.location_id`.

## Migrations (run in order)

| # | File | Phase | Notes |
|---|------|-------|-------|
| 1 | `20260614170000_org_scoped_tenancy.sql` | expand | **Destructive customer merge.** Already in `main` (#339). |
| 2 | `20260614180000_org_tenancy_contract.sql` | contract | Drops `customers.location_id` + its trigger; **re-points `dashboard_stats` + `platform_org_overview`**; adds accountant finance RLS. |
| 3 | `20260614190000_revenue_stats_org.sql` | additive | `revenue_stats_org(p_organization_id)` for the org-wide revenue view. |

Apply with the Supabase CLI against the staging branch:

```bash
supabase db push        # or: supabase migration up --linked
```

### ⚠️ Why the contract drop is non-trivial
`DROP COLUMN customers.location_id` is **dependency-tracked**: a view and a SQL
function read that column, so a naive drop is *refused* by Postgres. The contract
migration re-points both **before** dropping:
- `public.platform_org_overview` (view) — `cust` CTE now counts by `organization_id`.
- `public.dashboard_stats` (SQL function) — per-branch customer figures move to `preferred_location_id`.

If the drop still errors with *"cannot drop column location_id because other
objects depend on it"*, a **new** dependency was added since this was written.
Find every dependent object (run against the **expand-only** schema, before the
contract):

```sql
select pg_describe_object(d.classid, d.objid, d.objsubid) as dependent_object
from pg_depend d
join pg_attribute a
  on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
where d.refobjid = 'public.customers'::regclass
  and a.attname = 'location_id'
  and d.deptype != 'i';
```

Re-point each (and the app code that reads it) before re-running the contract.

## Data-integrity checks (after expand + contract, on prod-like data)

```sql
-- 1. No duplicate customers per org (the merge collapsed them).
select organization_id, lower(email) as email, count(*)
from public.customers
where email is not null and email <> ''
group by 1, 2 having count(*) > 1;            -- expect 0 rows

-- 2. organization_id NOT NULL everywhere it was added.
select 'customers' t, count(*) from public.customers where organization_id is null
union all select 'vehicles', count(*) from public.vehicles where organization_id is null
union all select 'service_plans', count(*) from public.service_plans where organization_id is null
union all select 'plan_subscriptions', count(*) from public.plan_subscriptions where organization_id is null
union all select 'reminders', count(*) from public.reminders where organization_id is null
union all select 'invoices', count(*) from public.invoices where organization_id is null
union all select 'credit_notes', count(*) from public.credit_notes where organization_id is null;
-- expect count = 0 on every row

-- 3. customers.location_id is gone; preferred_location_id survived + populated.
select count(*) as missing_column
from information_schema.columns
where table_name = 'customers' and column_name = 'location_id';   -- expect 0
select count(*) as customers_without_home_branch
from public.customers where preferred_location_id is null;        -- expect 0 (or only intentional)

-- 4. vehicles keep location_id (the servicing branch the cron routes on).
select count(*) as has_column
from information_schema.columns
where table_name = 'vehicles' and column_name = 'location_id';     -- expect 1

-- 5. No orphaned children after the merge + vehicle de-dupe.
select 'vehicles' t, count(*) from public.vehicles v left join public.customers c on c.id = v.customer_id where v.customer_id is not null and c.id is null
union all select 'jobs', count(*) from public.jobs j left join public.customers c on c.id = j.customer_id where j.customer_id is not null and c.id is null
union all select 'invoices', count(*) from public.invoices i left join public.customers c on c.id = i.customer_id where i.customer_id is not null and c.id is null
union all select 'plan_subscriptions', count(*) from public.plan_subscriptions p left join public.customers c on c.id = p.customer_id where p.customer_id is not null and c.id is null;
-- expect count = 0 on every row

-- 6. The re-pointed objects still resolve (no stale location_id reference).
select * from public.platform_org_overview limit 1;               -- must not error
select public.dashboard_stats(
  (select id from public.locations limit 1),
  now(), now(), now(), now(), now(), current_date, now(), now(), now()
);                                                                  -- must not error
```

## RLS proof (3 JWTs via `set request.jwt.claims`)

Pick a multi-location org on staging and three real `auth.users` ids: a
**location mechanic** (a `location_users` row at branch A only), an
**accountant** (`org_users.role = 'accountant'`), and an **owner**
(`org_users.role = 'owner'`). Run each block in a fresh transaction.

```sql
-- LOCATION MECHANIC (branch A): org-wide customers/vehicles; own-branch jobs
-- only; cannot read another branch's jobs.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<mechanic-user-id>","role":"authenticated"}';
select count(*) from public.customers;                 -- > 0 (org-wide read)
select count(*) from public.vehicles;                  -- > 0
select count(*) from public.jobs where location_id = '<branch-A-id>';  -- > 0
select count(*) from public.jobs where location_id = '<branch-B-id>';  -- expect 0
rollback;

-- ACCOUNTANT: invoices + standalone_quotes + finance_applications across all
-- branches; cannot read jobs/bookings.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<accountant-user-id>","role":"authenticated"}';
select count(distinct location_id) from public.invoices;             -- spans branches
select count(*) from public.standalone_quotes;                       -- > 0
select count(*) from public.finance_applications;                    -- > 0
select count(*) from public.jobs;                                    -- expect 0
select count(*) from public.bookings;                                -- expect 0
rollback;

-- OWNER: reads everything.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<owner-user-id>","role":"authenticated"}';
select count(*) from public.jobs;                      -- > 0
select count(*) from public.invoices;                  -- > 0
rollback;
```

## e2e (`npm run test:e2e` + manual via `*.localtest.me`)

Use a **two-location** staging org.

- [ ] **Register once at the org** → the customer is visible at a second branch (staff customers list at branch B shows them).
- [ ] **Branch picker** (register, public `/book`, logged-in `/dashboard/book`): shows for the 2-location org, hidden for a 1-location org; choosing a branch **re-filters the services list** and the booking lands on the chosen `booking.location_id`.
- [ ] **Switch the active branch** (top-bar switcher) → jobs/bookings lists change; the customers list does **not** (org-global).
- [ ] **Finance roll-up**: owner/accountant see org-wide totals on revenue/finance/invoices/reports; the **All locations / {branch}** toggle drops to the active branch; a location-only mechanic sees only their branch and **no** toggle.
- [ ] **Crons** still route by `vehicles.location_id`: reminders + MOT-delta.
- [ ] **AI receptionist** + **CSV import** still create customers/vehicles (customers now get `organization_id` + `preferred_location_id`, no `location_id`).
- [ ] **Staff dashboard** (`dashboard_stats`) loads; the `total_customers` / customers-per-week figures now reflect `preferred_location_id` (identical for single-location orgs).
- [ ] **Plans**: customer sees org-wide plans; subscribing records the subscription against the **plan's** branch; financing an invoice attributes to the **invoice's** branch.

## Merge / deploy order

1. Foundation (contract + `#341` portal read-scoping) — removes every `customers.location_id` read/write.
2. `#342` branch-picker UI.
3. `#343` org-wide finance.
4. Apply the migrations on staging, run this gate, then prod.

The app PRs are **no-ops for single-location tenants** and safe to deploy ahead
of the migrations (they read `organization_id`, which the expand already
populated). The **contract migration** must not reach prod until this gate is
green, because it drops `customers.location_id`.
