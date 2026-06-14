-- Org-scoped tenancy — PHASE 2 (CONTRACT).
--
-- Run AFTER the expand migration (20260614170000) AND after the app that stopped
-- reading/writing customers.location_id is deployed (this PR).
--
-- Customers are now fully org-scoped: the home/preferred branch lives in
-- customers.preferred_location_id, so the legacy customers.location_id column
-- (with its per-location UNIQUE + FK) is removed. Every customer insert now sets
-- organization_id explicitly, so the customers org-fill trigger is dropped too.
--
-- VEHICLES intentionally KEEP location_id — it is the servicing/home branch the
-- reminder + MOT-delta cron routes on (vehicles stay org-global for reads via
-- organization_id; location_id is just the branch that services the car). Their
-- org-fill trigger therefore stays.

-- 1. Drop the customers org-fill trigger (its source column is going away; the
--    app sets organization_id directly now). The shared function is kept — other
--    tables (vehicles, invoices, …) still use it.
drop trigger if exists trg_customers_set_org on public.customers;

-- 2. Drop the legacy column. DROP COLUMN cascades its dependents: the old
--    UNIQUE(location_id, email) and the FK to locations. The org-level unique
--    index (customers_org_email_key) and preferred_location_id remain.
alter table public.customers drop column if exists location_id;

-- 3. Accountant global finance — let owner|admin|accountant read quotes and
--    finance applications across every branch.
drop policy if exists "finance_applications_member_read" on public.finance_applications;
create policy "finance_applications_member_read" on public.finance_applications
  for select to authenticated
  using (private.is_location_member(location_id) or private.is_org_finance(organization_id));

-- standalone_quotes already has a FOR ALL member policy; add a finance-read
-- alongside it (permissive policies combine with OR).
drop policy if exists "standalone_quotes_finance_read" on public.standalone_quotes;
create policy "standalone_quotes_finance_read" on public.standalone_quotes
  for select to authenticated
  using (private.is_org_finance(organization_id));
