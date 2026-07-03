-- Phase 6 (quote reminders, #246): track which channels a quote went out on,
-- and keep an encrypted copy of the raw link token so reminders (manual +
-- cron) can rebuild the customer URL without re-minting — the original link
-- keeps working. Token is AES-256-GCM encrypted app-side (APP_ENCRYPTION_KEY,
-- same layer as Xero OAuth tokens); the sha256 token_hash remains the only
-- value used for verification.

alter table public.quotes
  add column if not exists sent_channels        text[] not null default '{}',
  add column if not exists link_token_encrypted text;
