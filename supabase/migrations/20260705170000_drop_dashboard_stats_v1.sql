-- Drop dashboard_stats v1, superseded by dashboard_stats_v2 (20260705120000).
--
-- v1 has zero callers since the role-aware dashboard cutover (#429/#430) and
-- still reads the dead `job_quotes` archive table — it MUST be gone before
-- quotes Phase 10 drops the archive tables, or that drop would break this
-- function's parse-time validation on any future re-create and leave a broken
-- object behind.
--
-- Deploy skew: a still-warm pre-#429 lambda calling v1 after this lands gets
-- an RPC error and the page renders its EMPTY_STATS zeros fallback — no crash.

drop function if exists public.dashboard_stats(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz,
  date, timestamptz, timestamptz, timestamptz
);
