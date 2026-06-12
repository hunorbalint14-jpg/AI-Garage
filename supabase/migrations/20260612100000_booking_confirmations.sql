-- Booking no-show defence, phase 1 (Tier 2 roadmap). T-24h confirmation
-- message with a token-gated one-tap confirm / request-reschedule page.
-- Card-on-file deposits (Stripe setup intents) are a later phase.

alter table public.bookings
  -- sha256 of the confirm link token; raw token never stored
  add column if not exists confirm_token_hash text,
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists reschedule_requested_at timestamptz;

-- New automation task type for the per-location scheduled_tasks fan-out.
alter table public.scheduled_tasks drop constraint if exists scheduled_tasks_task_type_check;
alter table public.scheduled_tasks add constraint scheduled_tasks_task_type_check
  check (task_type in (
    'mot_reminders', 'service_reminders', 'tax_reminders', 'weekly_digest',
    'invoice_dunning', 'review_requests', 'booking_confirmations'
  ));
