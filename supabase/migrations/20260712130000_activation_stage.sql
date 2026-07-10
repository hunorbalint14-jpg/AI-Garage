-- Activation email sequence (#506 PR 4): how many of the day-1/3/7 touches
-- have been sent. 0 = none, 3 = sequence complete (or stopped early — the
-- cron writes 3 when the org activates so it never reconsiders the row).
alter table public.organizations
  add column if not exists activation_stage integer not null default 0;
