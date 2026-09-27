-- Tyre-care recommendations + review queue (#596, docs/tyre-care-build-spec.md, PR 4).
-- One row per recommendation the engine raises for a customer's vehicle,
-- carrying the structured evidence it was raised on so a bad recommendation
-- can be audited and thresholds tuned honestly later. Rows route to the
-- customer's HOME branch, like MOT/service reminders.
--
-- The PR 5 columns (book_token_hash, sent_at, converted_*) land now so the
-- queue planner can already respect "recently contacted" and the next PR
-- needs no schema change.

create table if not exists public.tyre_recommendations (
  id                    uuid primary key default gen_random_uuid(),
  location_id           uuid not null references public.locations(id) on delete cascade,
  organization_id       uuid references public.organizations(id) on delete cascade,
  customer_id           uuid not null references public.customers(id) on delete cascade,
  vehicle_id            uuid not null references public.vehicles(id) on delete cascade,
  service_type          text not null check (service_type in ('rotation', 'alignment', 'balance')),
  confidence            text not null check (confidence in ('high', 'low')),
  evidence              jsonb not null,
  status                text not null default 'pending_review'
                          check (status in ('pending_review', 'approved_sent', 'dismissed', 'converted', 'expired')),
  dismissed_reason      text,
  reviewed_by           uuid references auth.users(id) on delete set null,
  reviewed_at           timestamptz,
  book_token_hash       text,
  sent_at               timestamptz,
  converted_booking_id  uuid references public.bookings(id) on delete set null,
  converted_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One live item per vehicle and service. The planner already avoids
-- duplicates; this makes a concurrent "Run now" during the hourly tick safe.
create unique index if not exists tyre_recommendations_one_pending_idx
  on public.tyre_recommendations (vehicle_id, service_type)
  where status = 'pending_review';

-- The review queue: a branch's items by status, newest first.
create index if not exists tyre_recommendations_queue_idx
  on public.tyre_recommendations (location_id, status, created_at desc);

-- The planner reads every row for the vehicles it evaluates.
create index if not exists tyre_recommendations_vehicle_idx
  on public.tyre_recommendations (vehicle_id);

create trigger set_org_from_location
  before insert on public.tyre_recommendations
  for each row execute function private.set_org_from_location();

alter table public.tyre_recommendations enable row level security;

-- Read-only to branch staff. Every write goes through the cron or a server
-- action on the admin client, so there is deliberately no write policy — no
-- direct-API path to forge a recommendation (compare the wheel_service_events
-- hole closed in 20260927100000).
create policy "tyre_recommendations_member_read" on public.tyre_recommendations
  for select to authenticated
  using (private.is_location_member(location_id));

-- ── Per-garage thresholds ────────────────────────────────────────────────────
-- Org-wide, like deferred_followup_days: one garage, one policy across
-- branches. The EV/hybrid multiplier is applied on top in code.
alter table public.organizations
  add column if not exists tyre_rotation_miles integer not null default 6000
    check (tyre_rotation_miles between 1000 and 30000),
  add column if not exists tyre_balance_miles integer not null default 12000
    check (tyre_balance_miles between 1000 and 50000);

-- ── Scheduled task ───────────────────────────────────────────────────────────
alter table public.scheduled_tasks drop constraint if exists scheduled_tasks_task_type_check;
alter table public.scheduled_tasks add constraint scheduled_tasks_task_type_check
  check (task_type in (
    'mot_reminders', 'service_reminders', 'tax_reminders', 'weekly_digest',
    'invoice_dunning', 'review_requests', 'booking_confirmations',
    'deferred_followups', 'tyre_care'
  ));
