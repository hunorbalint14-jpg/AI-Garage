-- Prelive mode (#585, epic #584, docs/prelive-build-spec.md PR 1).
--
-- A branch is PRELIVE until someone goes live: it can hold real customer data
-- and be learned on, but no unattended cron sends anything to its customers.
-- Null live_at = prelive; a timestamp = live (and records WHEN, which is what
-- activation reporting and support actually want).
--
-- CRITICAL: every EXISTING location is stamped live in this same migration.
-- Shipping the column null-by-default would silence production the moment it
-- deployed. Only locations created after this point start prelive.

alter table public.locations
  add column if not exists live_at timestamptz;

update public.locations
  set live_at = now()
  where live_at is null;

comment on column public.locations.live_at is
  'When this branch went live. Null = prelive: unattended customer comms (reminders, dunning, review requests, booking confirmations, deferred follow-ups, quote reminders) are held. Staff-initiated sends and platform/auth email always go.';

-- The cron routes filter on it every run.
create index if not exists locations_live_at_idx on public.locations (live_at);
