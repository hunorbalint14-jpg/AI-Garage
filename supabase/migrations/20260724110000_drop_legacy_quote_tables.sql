-- Phase 10 (#252): drop the legacy job_quotes / standalone_quotes archives,
-- last step of the Unified Quote Management epic (#253).
--
-- Pre-flight, verified against the live migration history (not just the
-- issue's draft, which guessed several object names):
--  * No remaining FK points at either table. bookings.from_quote_id_fkey was
--    re-pointed at public.quotes in 20260703110000 (Phase 7, #255) — the only
--    other referencer, the baseline FK from 20260522000001, was superseded
--    by that same re-point.
--  * public.platform_org_overview (platform admin view) was the last live
--    dependency — re-pointed at public.quotes in the migration immediately
--    before this one (20260724100000). Without that fix this DROP would
--    break platform admin org-detail pages the next time the view is queried.
--  * `grep -r "job_quotes\|standalone_quotes" src/` returns zero functional
--    references (a handful of comments/log strings were the only hits —
--    cleaned up alongside this migration, not blocking).
--  * status was a `text ... check (...)` column on both legacy tables, not
--    an enum type — there is no job_quote_status / standalone_quote_status
--    type to drop. public.quote_type (used by the live `quotes` table) is
--    untouched.
--  * The job-quote-videos storage bucket is still used by the unified
--    `quotes` table (src/lib/quote-storage.ts) — left alone.
--  * organizations.quote_deposit_pct / quote_validity_days / quote_reminder_*
--    are live per-org settings for the unified quotes flow, not legacy
--    columns — left alone.
--
-- Row-count reconciliation, FK-integrity, and legacy-slug spot checks (the
-- issue's pre-flight steps 2-4) must still be run against production before
-- this is applied there — they need live data this migration file can't see.

-- Tables FIRST. DROP TABLE cascades each table's own indexes, triggers, and
-- RLS policies automatically — no separate DROP INDEX/TRIGGER/POLICY needed.
-- Item tables (FK children) before their parents.
--
-- Order matters vs the functions below: the touch_*_updated_at() functions
-- are still referenced by the BEFORE UPDATE triggers on these tables, so a
-- DROP FUNCTION while the tables exist is REFUSED by Postgres (the trigger
-- depends on the function). Dropping the tables removes those triggers first,
-- leaving the functions genuinely orphaned and safe to drop.
drop table if exists public.job_quote_items;
drop table if exists public.standalone_quote_items;
drop table if exists public.job_quotes;
drop table if exists public.standalone_quotes;

-- Now-orphaned functions. The increment_view RPCs were never trigger-bound
-- (standalone SECURITY DEFINER functions, revoked from all roles in
-- 20260612150000); the touch_* functions lost their last dependent trigger
-- when the tables above were dropped.
drop function if exists public.job_quotes_increment_view(uuid);
drop function if exists public.standalone_quotes_increment_view(uuid);
drop function if exists public.touch_job_quotes_updated_at();
drop function if exists public.touch_standalone_quotes_updated_at();
