-- Held customer comms (#586, epic #584, docs/prelive-build-spec.md PR 2).
--
-- While a branch is prelive the crons still work out who they WOULD message —
-- they just record it here instead of sending. The Go-live screen reads this
-- to tell the owner exactly what happens when they flip the switch.
--
-- It is a PENDING SET, not an append-only log: one row per (branch, kind,
-- subject), upserted on every run, with last_seen_at refreshed. A daily cron
-- would otherwise write a duplicate row per customer per day, and the counts
-- shown to the owner would be nonsense.
--
-- Deliberately NOT the `reminders` table: that one is the 30-day dedup source
-- for real sends, so a held row written there would suppress the genuine
-- message after go-live.

create table if not exists public.held_comms (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations(id) on delete cascade,
  organization_id    uuid references public.organizations(id) on delete cascade,
  kind               text not null check (kind in (
                       'mot_reminder', 'service_reminder', 'tax_reminder',
                       'invoice_dunning', 'review_request', 'booking_confirmation',
                       'deferred_followup', 'quote_reminder'
                     )),
  customer_id        uuid references public.customers(id) on delete cascade,
  -- What the message would have been about: the vehicle, invoice, booking …
  ref_table          text not null,
  ref_id             uuid not null,
  -- One human-readable line for the sample list ("AB12 CDE — MOT due 3 Aug").
  summary            text not null,
  would_have_sent_at timestamptz not null default now(),
  -- Refreshed every run. Rows stop being refreshed when the underlying thing
  -- no longer qualifies (invoice paid, booking cancelled), so stale entries
  -- age out of the counts instead of inflating them forever.
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  unique (location_id, kind, ref_id)
);

create index if not exists held_comms_location_idx
  on public.held_comms (location_id, last_seen_at desc);

create trigger set_org_from_location
  before insert on public.held_comms
  for each row execute function private.set_org_from_location();

alter table public.held_comms enable row level security;

-- Customer PII (names and what we'd say about their vehicle). Branch staff
-- read it; every write is admin-client only from the cron routes, so there are
-- deliberately no insert/update/delete policies.
create policy "held_comms_select" on public.held_comms
  for select to authenticated
  using (private.is_location_member(location_id));

grant all on public.held_comms to service_role;
