-- Deferred-work follow-up sequence (#498, PR 3). New per-location automation
-- task type + the org-configurable stage offsets. Task rows are seeded lazily
-- by ensureDefaultTasks (the established pattern for every task type since
-- invoice_dunning); sends are additionally gated behind the global
-- `deferred_followups` feature flag for staged rollout.

alter table public.organizations
  add column if not exists deferred_followup_days integer[] not null default '{14,30}';

alter table public.scheduled_tasks drop constraint if exists scheduled_tasks_task_type_check;
alter table public.scheduled_tasks add constraint scheduled_tasks_task_type_check
  check (task_type in (
    'mot_reminders', 'service_reminders', 'tax_reminders', 'weekly_digest',
    'invoice_dunning', 'review_requests', 'booking_confirmations',
    'deferred_followups'
  ));
