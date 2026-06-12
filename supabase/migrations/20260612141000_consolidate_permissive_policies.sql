-- Supabase advisory (multiple_permissive_policies): six tables had a FOR ALL
-- policy plus one or more FOR SELECT policies — every SELECT evaluated all of
-- them, for anon as well as authenticated. Restructured to exactly one
-- permissive policy per (action), scoped `to authenticated`:
--   * SELECT policies merge the old conditions with OR (semantics unchanged —
--     permissive policies always combined with OR anyway);
--   * the old FOR ALL write conditions move to per-action policies.
-- anon loses its (never-matching) policies entirely; anon-facing flows all go
-- through the service-role admin client, which bypasses RLS. auth.uid() stays
-- wrapped in (select ...) per the auth_rls_initplan fix.

-- customers -------------------------------------------------------------------
drop policy if exists "customers_member_all" on public.customers;
drop policy if exists "customers_select_self" on public.customers;

create policy "customers_select" on public.customers
  for select to authenticated
  using (public.is_location_member(location_id) or user_id = (select auth.uid()));
create policy "customers_insert" on public.customers
  for insert to authenticated
  with check (public.is_location_member(location_id));
create policy "customers_update" on public.customers
  for update to authenticated
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));
create policy "customers_delete" on public.customers
  for delete to authenticated
  using (public.is_location_member(location_id));

-- vehicles --------------------------------------------------------------------
drop policy if exists "vehicles_member_all" on public.vehicles;
drop policy if exists "vehicles_select_own" on public.vehicles;

create policy "vehicles_select" on public.vehicles
  for select to authenticated
  using (
    public.is_location_member(location_id)
    or customer_id in (
      select customers.id from public.customers
      where customers.user_id = (select auth.uid())
    )
  );
create policy "vehicles_insert" on public.vehicles
  for insert to authenticated
  with check (public.is_location_member(location_id));
create policy "vehicles_update" on public.vehicles
  for update to authenticated
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));
create policy "vehicles_delete" on public.vehicles
  for delete to authenticated
  using (public.is_location_member(location_id));

-- org_users -------------------------------------------------------------------
drop policy if exists "org_users_owner_manage" on public.org_users;
drop policy if exists "org_users_select_same_org" on public.org_users;
drop policy if exists "org_users_select_self" on public.org_users;

create policy "org_users_select" on public.org_users
  for select to authenticated
  using (public.is_org_member(organization_id) or user_id = (select auth.uid()));
create policy "org_users_insert" on public.org_users
  for insert to authenticated
  with check (public.is_org_owner(organization_id));
create policy "org_users_update" on public.org_users
  for update to authenticated
  using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));
create policy "org_users_delete" on public.org_users
  for delete to authenticated
  using (public.is_org_owner(organization_id));

-- location_users ----------------------------------------------------------------
drop policy if exists "location_users_org_owner_manage" on public.location_users;
drop policy if exists "location_users_select_same_location" on public.location_users;
drop policy if exists "location_users_select_self" on public.location_users;

create policy "location_users_select" on public.location_users
  for select to authenticated
  using (
    public.is_location_member(location_id)
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  );
create policy "location_users_insert" on public.location_users
  for insert to authenticated
  with check (
    exists (
      select 1 from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  );
create policy "location_users_update" on public.location_users
  for update to authenticated
  using (
    exists (
      select 1 from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  );
create policy "location_users_delete" on public.location_users
  for delete to authenticated
  using (
    exists (
      select 1 from public.locations l
      where l.id = location_users.location_id
        and public.is_org_owner(l.organization_id)
    )
  );

-- doc_shares --------------------------------------------------------------------
drop policy if exists "doc_shares_owner_manage" on public.doc_shares;
drop policy if exists "doc_shares_owner_select" on public.doc_shares;

-- Old select allowed owner+admin; old manage (ALL) allowed owner. Merged
-- select keeps owner+admin; writes stay owner-only.
create policy "doc_shares_select" on public.doc_shares
  for select to authenticated
  using (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = doc_shares.organization_id
        and org_users.role in ('owner', 'admin')
    )
  );
create policy "doc_shares_insert" on public.doc_shares
  for insert to authenticated
  with check (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = doc_shares.organization_id
        and org_users.role = 'owner'
    )
  );
create policy "doc_shares_update" on public.doc_shares
  for update to authenticated
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
create policy "doc_shares_delete" on public.doc_shares
  for delete to authenticated
  using (
    organization_id is not null
    and exists (
      select 1 from public.org_users
      where org_users.user_id = (select auth.uid())
        and org_users.organization_id = doc_shares.organization_id
        and org_users.role = 'owner'
    )
  );

-- role_templates ------------------------------------------------------------------
-- Old write policy was FOR ALL, so its owner/admin members also matched on
-- SELECT — but they're org members, already covered by the read policy.
-- Write policy becomes per-action; read policy just gains `to authenticated`.
drop policy if exists "role_templates_read_org_member" on public.role_templates;
drop policy if exists "role_templates_write_owner_admin" on public.role_templates;

create policy "role_templates_select" on public.role_templates
  for select to authenticated
  using (
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
create policy "role_templates_insert" on public.role_templates
  for insert to authenticated
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
create policy "role_templates_update" on public.role_templates
  for update to authenticated
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
create policy "role_templates_delete" on public.role_templates
  for delete to authenticated
  using (
    organization_id is not null
    and is_system = false
    and exists (
      select 1 from public.org_users ou
      where ou.organization_id = role_templates.organization_id
        and ou.user_id = (select auth.uid())
        and ou.role in ('owner', 'admin')
    )
  );
