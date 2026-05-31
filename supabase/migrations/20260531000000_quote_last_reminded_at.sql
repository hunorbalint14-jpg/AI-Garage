-- "Remind customer" action for pending quotes (issue #135).
-- Reminders rotate the mint-once token (only sha256(token) is stored, so the
-- original link can't be re-derived) and re-send the link. We track the most
-- recent reminder separately from `sent_at` (which stays as the first send)
-- so the timeline and audit trail can distinguish original send vs reminders.
alter table public.job_quotes
  add column if not exists last_reminded_at timestamptz;

alter table public.standalone_quotes
  add column if not exists last_reminded_at timestamptz;
