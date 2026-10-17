-- Courtesy-trial "ending soon" email dedupe (follow-up to #648).
-- Holds the tenant_trial_end the owner was last emailed about. Storing the END
-- DATE rather than a sent flag makes the notice once-per-trial with no reset
-- step: a platform admin re-granting or replacing a trial moves
-- tenant_trial_end, the two stop matching, and the new trial gets its own
-- notice. Written only by the service role (cron/trial-ending), so no new RLS.
alter table public.organizations
  add column if not exists tenant_trial_notice_for timestamptz;
