-- First-run policy after go-live (#587, epic #584, docs/prelive-build-spec.md PR 3).
--
-- Prelive holds everything; the hazard it creates is the release. A branch that
-- goes live at 16:00 has every held message fire in one 09:00 run the next
-- morning, and every invoice that was already overdue chased on day one.
--
-- Two independent controls, both decided on the Go-live screen BEFORE the flip:
--
--   first_run_cap        — most customer-facing messages one reminder run may
--                          send during the branch's first 24 hours live. The
--                          remainder is not dropped: nothing is marked sent, so
--                          the next day's run picks it up. Null = uncapped.
--
--   chase_prelive_debt   — whether dunning may chase invoices that were already
--                          overdue when the branch went live. Default false:
--                          debt that predates us is the garage's to collect by
--                          hand, not something to auto-chase on day one. This
--                          one is PERMANENT, not first-day — suppressing it for
--                          24 hours would just move the same blast to day two.

alter table public.locations
  add column if not exists first_run_cap      int default 25,
  add column if not exists chase_prelive_debt boolean not null default false;

alter table public.locations
  add constraint locations_first_run_cap_positive
  check (first_run_cap is null or first_run_cap > 0);

comment on column public.locations.first_run_cap is
  'Max customer-facing messages per reminder run during the first 24h after live_at. Null = uncapped. Unsent work rolls to the next run.';
comment on column public.locations.chase_prelive_debt is
  'When false (default), invoices already overdue at live_at are never auto-chased by dunning.';
