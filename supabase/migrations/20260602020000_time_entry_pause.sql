-- Pause/resume + manual override for job time entries (Phase 3 follow-up).
-- The original model recorded raw elapsed time (started_at → ended_at), which
-- over-counts idle waits (on-call alerts) and forgotten punch-outs. This makes
-- an entry a sequence of active segments:
--   active_minutes      = banked active minutes from segments already paused/closed
--   segment_started_at  = start of the CURRENT running segment (null when paused/completed)
--   status              = running | paused | completed
-- On clock-out / pause we bank the running segment; duration_minutes still holds
-- the final total (now = active work, not elapsed), and can be manually overridden.

alter table public.job_time_entries
  add column if not exists status text not null default 'running'
    check (status in ('running', 'paused', 'completed')),
  add column if not exists active_minutes int not null default 0,
  add column if not exists segment_started_at timestamptz;

-- Backfill existing rows created before this migration:
--  - closed entries → completed (duration_minutes already holds their total)
update public.job_time_entries
  set status = 'completed'
  where ended_at is not null and status <> 'completed';

--  - still-open entries → their single running segment starts at started_at
update public.job_time_entries
  set segment_started_at = started_at
  where ended_at is null and segment_started_at is null;
