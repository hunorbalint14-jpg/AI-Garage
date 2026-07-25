-- Alert delivery + dead-cron detection (#450).
--
-- Two gaps this closes:
--   1. Slack was the only wired channel, and it no-ops when
--      SLACK_OPS_WEBHOOK_URL is unset — so on a fresh production every alert
--      fired into the void. Email is now the delivery floor, and last_delivery
--      records what actually got through so the admin panel can prove it.
--   2. Nothing watched for a cron that simply stops. The new rule fires the
--      moment a Vercel-scheduled job misses its allowance.

alter table public.alert_rules
  add column if not exists last_delivery text;

comment on column public.alert_rules.last_delivery is
  'How the most recent firing was delivered: slack | email | none. "none" means nobody was told.';

-- Existing rules targeted Slack only. Adding the email channel explicitly keeps
-- the intent visible in the admin UI (the code would fall back regardless).
update public.alert_rules
   set channels = array_append(channels, 'Email ops')
 where not exists (
   select 1 from unnest(channels) c where c ilike '%mail%'
 );

-- Dead cron. Threshold 0: the metric is "worst overdue minutes", so anything
-- above zero means a watched job missed its window. Auto-declares an incident —
-- a stopped cron silently stops reminders, dunning and quote expiry.
insert into public.alert_rules
  (id, name, metric, operator, threshold, window_secs, source, severity, auto_declare, channels, enabled)
values
  ('ar-cron-stale', 'Scheduled job not running', 'cron_stale_mins', '>', 0, 900, 'Cron', 'SEV-2', true,
   array['Slack #ops', 'Email ops'], true)
on conflict (id) do nothing;
