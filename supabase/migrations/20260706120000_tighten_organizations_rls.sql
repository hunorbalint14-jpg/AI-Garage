-- Pre-launch RLS audit (#447): the organizations SELECT policy was
-- `using (true)` with no role clause (i.e. PUBLIC), so an unauthenticated
-- request with the public anon key could read every organisation's full row —
-- including the AES-encrypted Xero OAuth tokens, stripe_account_id, tenant
-- Stripe customer/subscription ids, ai_brief and subscription status. This is
-- cross-tenant information disclosure.
--
-- The application never needs anon (or authenticated-non-member) access to
-- organizations: every read goes through the service-role admin client (which
-- bypasses RLS), and the only RLS-subject read is a member reading their own
-- org (support assist). Scope the policy to org members + platform admins,
-- mirroring the sibling locations_select_member policy created in the same
-- original migration (20260502170000).

drop policy if exists "organizations_select_public" on public.organizations;

create policy "organizations_select_member"
  on public.organizations for select
  to authenticated
  using (private.is_org_member(id) or private.is_platform_admin());
