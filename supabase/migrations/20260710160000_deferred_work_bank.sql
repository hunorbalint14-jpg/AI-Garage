-- Deferred-work bank (#498, docs/deferred-followup-build-spec.md, PR 2).
-- One snapshot row per outstanding repair a customer declined or was advised
-- about but never quoted. Description + price are SNAPSHOTS so the record
-- survives source deletion; follow-up state (Phase 3) and recovery
-- attribution live here too. Operational data: per-branch, like jobs.

create table if not exists public.deferred_work (
  id                   uuid primary key default gen_random_uuid(),
  location_id          uuid not null references public.locations(id) on delete cascade,
  organization_id      uuid references public.organizations(id) on delete cascade,
  customer_id          uuid references public.customers(id) on delete cascade,
  vehicle_id           uuid references public.vehicles(id) on delete cascade,
  job_id               uuid references public.jobs(id) on delete set null,
  source               text not null check (source in ('quote_item', 'inspection_item')),
  quote_item_id        uuid references public.quote_items(id) on delete set null,
  inspection_item_id   uuid references public.inspection_items(id) on delete set null,
  description          text not null,
  price                numeric(10,2),
  rag                  text check (rag in ('amber', 'red')),
  status               text not null default 'open'
                         check (status in ('open', 'recovered', 'dismissed')),
  followup_count       integer not null default 0,
  last_followup_at     timestamptz,
  book_token_hash      text,
  recovered_booking_id uuid references public.bookings(id) on delete set null,
  recovered_at         timestamptz,
  dismissed_reason     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists deferred_work_location_idx on public.deferred_work (location_id);
create index if not exists deferred_work_customer_idx on public.deferred_work (customer_id);
create index if not exists deferred_work_vehicle_open_idx
  on public.deferred_work (vehicle_id) where status = 'open';
-- The follow-up cron scans open records by age per location.
create index if not exists deferred_work_followup_idx
  on public.deferred_work (location_id, created_at) where status = 'open';

create trigger set_org_from_location
  before insert on public.deferred_work
  for each row execute function private.set_org_from_location();

alter table public.deferred_work enable row level security;

create policy "deferred_work_all" on public.deferred_work
  for all to authenticated
  using (private.is_location_member(location_id))
  with check (private.is_location_member(location_id));

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- History so the bank isn't empty on day one. created_at = when the customer
-- said no (responded_at) or when the finding was recorded.

-- 1) Every line of a declined quote.
insert into public.deferred_work
  (location_id, customer_id, vehicle_id, job_id, source, quote_item_id,
   inspection_item_id, description, price, rag, created_at)
select
  q.location_id,
  coalesce(q.customer_id, j.customer_id),
  coalesce(q.vehicle_id, j.vehicle_id),
  q.job_id,
  'quote_item',
  qi.id,
  qi.inspection_item_id,
  -- Short repair-line label when the line prices a finding; the raw line
  -- description otherwise. Full customer wording stays on the sources.
  coalesce(nullif(trim(it.suggested_repair), ''), it.label, qi.description),
  round((qi.quantity * qi.unit_price)::numeric, 2),
  it.rag,
  coalesce(q.responded_at, q.created_at)
from public.quote_items qi
join public.quotes q on q.id = qi.quote_id
left join public.jobs j on j.id = q.job_id
left join public.inspection_items it
  on it.id = qi.inspection_item_id and it.rag in ('amber', 'red')
where q.status = 'declined';

-- 2) Unapproved lines of partially approved quotes.
insert into public.deferred_work
  (location_id, customer_id, vehicle_id, job_id, source, quote_item_id,
   inspection_item_id, description, price, rag, created_at)
select
  q.location_id,
  coalesce(q.customer_id, j.customer_id),
  coalesce(q.vehicle_id, j.vehicle_id),
  q.job_id,
  'quote_item',
  qi.id,
  qi.inspection_item_id,
  -- Short repair-line label when the line prices a finding; the raw line
  -- description otherwise. Full customer wording stays on the sources.
  coalesce(nullif(trim(it.suggested_repair), ''), it.label, qi.description),
  round((qi.quantity * qi.unit_price)::numeric, 2),
  it.rag,
  coalesce(q.responded_at, q.created_at)
from public.quote_items qi
join public.quotes q on q.id = qi.quote_id
left join public.jobs j on j.id = q.job_id
left join public.inspection_items it
  on it.id = qi.inspection_item_id and it.rag in ('amber', 'red')
where q.status in ('approved', 'approved_after_close')
  and q.approved_item_ids is not null
  and array_length(q.approved_item_ids, 1) > 0
  and not (qi.id = any (q.approved_item_ids));

-- 3) Amber/red findings never quoted (outcome 'none') on completed or sent
--    checks — outcome 'declined' rows are already covered by (1)/(2) through
--    their quote lines.
insert into public.deferred_work
  (location_id, customer_id, vehicle_id, job_id, source, inspection_item_id,
   description, price, rag, created_at)
select
  i.location_id,
  j.customer_id,
  i.vehicle_id,
  i.job_id,
  'inspection_item',
  it.id,
  coalesce(nullif(trim(it.suggested_repair), ''), it.label),
  it.suggested_price,
  it.rag,
  it.created_at
from public.inspection_items it
join public.inspections i on i.id = it.inspection_id
left join public.jobs j on j.id = i.job_id
where it.rag in ('amber', 'red')
  and it.outcome = 'none'
  and i.status in ('complete', 'sent');

-- 4) Dedupe: one OPEN row per (vehicle, lower(description)) — keep newest.
delete from public.deferred_work a
using public.deferred_work b
where a.status = 'open'
  and b.status = 'open'
  and a.id <> b.id
  and a.vehicle_id is not distinct from b.vehicle_id
  and lower(a.description) = lower(b.description)
  and (b.created_at > a.created_at or (b.created_at = a.created_at and b.id > a.id));
