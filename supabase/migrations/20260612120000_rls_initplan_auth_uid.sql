-- Supabase performance advisory (auth_rls_initplan): bare auth.uid() in an
-- RLS policy is re-evaluated for every candidate row; wrapping it as
-- (select auth.uid()) turns it into an InitPlan evaluated once per query.
-- Recreates every policy that called auth.uid() directly — both the simple
-- user_id = auth.uid() ones and those with the call inside a correlated
-- EXISTS/IN subquery. Expressions are otherwise identical to prod.

-- customers ------------------------------------------------------------------
drop policy if exists "customers_select_self" on public.customers;
create policy "customers_select_self" on public.customers
  for select using (user_id = (select auth.uid()));

-- vehicles -------------------------------------------------------------------
drop policy if exists "vehicles_select_own" on public.vehicles;
create policy "vehicles_select_own" on public.vehicles
  for select using (
    customer_id in (
      select customers.id from public.customers
      where customers.user_id = (select auth.uid())
    )
  );

-- location_users -------------------------------------------------------------
drop policy if exists "location_users_select_self" on public.location_users;
create policy "location_users_select_self" on public.location_users
  for select using (user_id = (select auth.uid()));

-- org_users ------------------------------------------------------------------
drop policy if exists "org_users_select_self" on public.org_users;
create policy "org_users_select_self" on public.org_users
  for select using (user_id = (select auth.uid()));

-- staff_notification_prefs ----------------------------------------------------
drop policy if exists "staff_notification_prefs_insert_own" on public.staff_notification_prefs;
create policy "staff_notification_prefs_insert_own" on public.staff_notification_prefs
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "staff_notification_prefs_select_own" on public.staff_notification_prefs;
create policy "staff_notification_prefs_select_own" on public.staff_notification_prefs
  for select using ((select auth.uid()) = user_id);

drop policy if exists "staff_notification_prefs_update_own" on public.staff_notification_prefs;
create policy "staff_notification_prefs_update_own" on public.staff_notification_prefs
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- audit_log ------------------------------------------------------------------
drop policy if exists "audit_log_owner_read" on public.audit_log;
create policy "audit_log_owner_read" on public.audit_log
  for select using (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = audit_log.organization_id
        and org_users.role in ('owner', 'admin')
    )
  );

-- doc_shares -----------------------------------------------------------------
drop policy if exists "doc_shares_owner_manage" on public.doc_shares;
create policy "doc_shares_owner_manage" on public.doc_shares
  using (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = doc_shares.organization_id
        and org_users.role = 'owner'
    )
  )
  with check (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = doc_shares.organization_id
        and org_users.role = 'owner'
    )
  );

drop policy if exists "doc_shares_owner_select" on public.doc_shares;
create policy "doc_shares_owner_select" on public.doc_shares
  for select using (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = doc_shares.organization_id
        and org_users.role in ('owner', 'admin')
    )
  );

-- role_templates -------------------------------------------------------------
drop policy if exists "role_templates_read_org_member" on public.role_templates;
create policy "role_templates_read_org_member" on public.role_templates
  for select using (
    organization_id is null
    or exists (
      select 1 from public.org_users ou
      where ou.organization_id = role_templates.organization_id
        and ou.user_id = (select auth.uid())
    )
    or exists (
      select 1
        from public.location_users lu
        join public.locations l on l.id = lu.location_id
      where lu.user_id = (select auth.uid())
        and l.organization_id = role_templates.organization_id
    )
  );

drop policy if exists "role_templates_write_owner_admin" on public.role_templates;
create policy "role_templates_write_owner_admin" on public.role_templates
  using (
    organization_id is not null
    and is_system = false
    and exists (
      select 1 from public.org_users ou
      where ou.organization_id = role_templates.organization_id
        and ou.user_id = (select auth.uid())
        and ou.role in ('owner', 'admin')
    )
  )
  with check (
    organization_id is not null
    and is_system = false
    and exists (
      select 1 from public.org_users ou
      where ou.organization_id = role_templates.organization_id
        and ou.user_id = (select auth.uid())
        and ou.role in ('owner', 'admin')
    )
  );
