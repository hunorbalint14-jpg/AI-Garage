-- Doc-share management moved from the staff portal (/staff/docs, org-owner
-- managed) to the platform admin portal (/admin/doc-shares, PLATFORM_ADMIN
-- allowlist only). All app access now goes through the service role inside
-- platform-admin-gated server actions, so authenticated users no longer need
-- any direct row access.
--
-- Dropping every doc_shares policy leaves RLS enabled with zero policies =
-- deny-all for anon/authenticated. service_role bypasses RLS, so the admin
-- portal keeps working.

drop policy if exists "doc_shares_select" on public.doc_shares;
drop policy if exists "doc_shares_insert" on public.doc_shares;
drop policy if exists "doc_shares_update" on public.doc_shares;
drop policy if exists "doc_shares_delete" on public.doc_shares;

-- Pre-consolidation names (replaced by 20260612141000) — drop too in case an
-- environment never ran that migration.
drop policy if exists "doc_shares_owner_manage" on public.doc_shares;
drop policy if exists "doc_shares_owner_select" on public.doc_shares;
