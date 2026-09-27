-- Tyre-care sends + unsubscribe (#596, docs/tyre-care-build-spec.md, PR 5).

-- ── Unsubscribe tokens (platform infra) ──────────────────────────────────────
-- One token minted per marketing message sent; only its sha256 is stored,
-- like every other token-gated public link. Rows are never overwritten, so
-- the unsubscribe link in an old email keeps working — PECR expects a
-- working opt-out on every marketing message, not just the latest one.
create table if not exists public.unsubscribe_tokens (
  token_hash      text primary key,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- What the message was: lets the landing page say what they are opting out of.
  source          text not null check (source in ('tyre_care')),
  created_at      timestamptz not null default now(),
  used_at         timestamptz
);

create index if not exists unsubscribe_tokens_customer_idx on public.unsubscribe_tokens (customer_id);

-- Service-role only: resolved by the public unsubscribe page/route through the
-- admin client. No policies = no direct-API access for any role.
alter table public.unsubscribe_tokens enable row level security;

-- ── Log tyre-care sends alongside every other reminder ──────────────────────
-- So the other senders' frequency caps see them. NOT VALID, matching the
-- existing constraint (legacy rows predate some values).
alter table public.reminders drop constraint if exists reminders_type_check;
alter table public.reminders add constraint reminders_type_check
  check (type in ('mot', 'service', 'tax', 'general', 'custom', 'campaign', 'tyre_care')) not valid;
