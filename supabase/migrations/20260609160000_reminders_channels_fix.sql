-- Reconcile the reminders table with what the app actually writes:
-- tax reminders, the whatsapp channel, phone recipients, and the Resend message
-- id used for delivery tracking. The original checks rejected these rows and
-- recipient_email was NOT NULL, so SMS/WhatsApp/tax inserts failed; those
-- errors were unchecked in the cron, and a missing row also defeats send
-- dedup (nothing recorded → the same reminder re-sends on the next run).
--
-- The full `type` domain written by the app today: 'mot' / 'service' / 'tax'
-- (cron + staff one-off sends), 'custom' (staff custom messages), 'campaign'
-- (broadcasts), plus legacy 'general'. Production already contains rows wider
-- than the original committed check, so the constraints are added NOT VALID:
-- they enforce the domain for new rows without failing the migration on
-- whatever legacy rows exist. Everything here is idempotent in case an
-- environment was already patched by hand.

alter table public.reminders add column if not exists recipient_phone text;
alter table public.reminders add column if not exists resend_email_id text;
alter table public.reminders alter column recipient_email drop not null;

alter table public.reminders drop constraint if exists reminders_type_check;
alter table public.reminders add constraint reminders_type_check
  check (type in ('mot', 'service', 'tax', 'general', 'custom', 'campaign')) not valid;

alter table public.reminders drop constraint if exists reminders_channel_check;
alter table public.reminders add constraint reminders_channel_check
  check (channel in ('email', 'sms', 'whatsapp')) not valid;
