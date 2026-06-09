-- Reconcile the reminders table with what the reminders cron actually writes:
-- tax reminders, the whatsapp channel, phone recipients, and the Resend message
-- id used for delivery tracking. The original checks rejected these rows and
-- recipient_email was NOT NULL, so SMS/WhatsApp/tax inserts failed; those
-- errors were unchecked in the cron, and a missing row also defeats send
-- dedup (nothing recorded → the same reminder re-sends on the next run).
-- Everything here is idempotent in case an environment was patched by hand.

alter table public.reminders add column if not exists recipient_phone text;
alter table public.reminders add column if not exists resend_email_id text;
alter table public.reminders alter column recipient_email drop not null;

alter table public.reminders drop constraint if exists reminders_type_check;
alter table public.reminders add constraint reminders_type_check
  check (type in ('mot', 'service', 'tax', 'general'));

alter table public.reminders drop constraint if exists reminders_channel_check;
alter table public.reminders add constraint reminders_channel_check
  check (channel in ('email', 'sms', 'whatsapp'));
