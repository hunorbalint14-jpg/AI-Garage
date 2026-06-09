-- Seed default platform alert rules (PR 4). Idempotent — re-runs are no-ops.
-- Only the Synthetic metrics (availability_pct, p95_ms) are evaluated today by
-- /api/cron/uptime; the Sentry/Stripe/Supabase rules are seeded but dormant
-- until their metric adapters land (PR 5). Tune thresholds in /admin/health.

insert into public.alert_rules
  (id, name, metric, operator, threshold, window_secs, source, severity, auto_declare, channels, enabled)
values
  ('ar-availability', 'API availability < SLO',       'availability_pct', '<', 99.9, 300, 'Synthetic', 'SEV-2', true, array['Slack #ops'], true),
  ('ar-p95',          'Synthetic p95 latency',         'p95_ms',          '>', 800,  600, 'Synthetic', 'SEV-3', true, array['Slack #ops'], true),
  ('ar-5xx',          'Platform 5xx error rate',       'error_rate_pct',  '>', 2.0,  300, 'Sentry',    'SEV-2', true, array['Slack #ops'], true),
  ('ar-webhook',      'Stripe webhook failure rate',   'webhook_5xx_rate','>', 5.0,  300, 'Stripe',    'SEV-1', true, array['Slack #ops'], true),
  ('ar-dbpool',       'DB connection pool saturation', 'db_pool_pct',     '>', 90,   60,  'Supabase',  'SEV-1', true, array['Slack #ops'], true)
on conflict (id) do nothing;
