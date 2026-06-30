-- Quotes Unification — Phase 1 (#241): unified quotes data model (foundation).
-- Collapses job_quotes + standalone_quotes into one public.quotes table with a
-- quote_type discriminator, backfills both, and keeps the old tables as
-- read-only archives (dropped in Phase 10). Pure DB phase — no app code changes
-- (the app still reads the old tables until Phase 2 cuts over).
--
-- Corrections vs the #241 spec, verified against the live schema:
--  * job_quotes has NO organization_id column → derive it from locations.
--  * RLS helper lives in the private schema (private.is_location_member).
--  * Current migration timestamp (the spec's 20260610 predates applied ones).

create type public.quote_type as enum ('job', 'standalone');

create table public.quotes (
  id                          uuid primary key default gen_random_uuid(),
  quote_type                  public.quote_type not null,
  organization_id             uuid not null references public.organizations(id) on delete cascade,
  location_id                 uuid not null references public.locations(id) on delete cascade,
  created_by                  uuid references auth.users(id) on delete set null,

  -- Type-conditional relationships.
  job_id                      uuid references public.jobs(id) on delete cascade,        -- job type
  customer_id                 uuid references public.customers(id) on delete cascade,   -- standalone type
  vehicle_id                  uuid references public.vehicles(id) on delete set null,   -- optional on both

  -- Content.
  title                       text not null,
  description                 text,
  customer_message            text,

  -- Video (optional on both).
  video_path                  text,
  video_mime                  text,
  video_size_bytes            bigint,
  video_duration_seconds      integer,

  -- Financials (per-row VAT, no hard-coded 20%).
  subtotal                    numeric(10,2) not null default 0,
  vat_rate                    numeric(5,2) not null default 20,
  vat_amount                  numeric(10,2) not null default 0,
  total                       numeric(10,2) not null default 0,

  -- Status.
  status                      text not null default 'draft'
                                check (status in ('draft','pending','approved','declined',
                                                  'rebooked','expired','cancelled','approved_after_close')),

  -- Token gate (nullable while draft).
  token_hash                  text unique,
  slug                        text unique,

  -- Lifecycle.
  expires_at                  timestamptz,
  sent_at                     timestamptz,
  viewed_at                   timestamptz,
  viewed_count                integer not null default 0,
  responded_at                timestamptz,

  -- Approval.
  approved_item_ids           uuid[],
  applied_job_item_ids        uuid[],            -- job type only
  decline_reason              text,

  -- Deposit (Stripe).
  deposit_pct                 numeric(5,2),
  deposit_amount              numeric(10,2),
  deposit_required            boolean not null default false,
  deposit_paid_at             timestamptz,
  stripe_checkout_session_id  text,
  stripe_payment_intent_id    text,

  -- Conversion (standalone type only).
  converted_booking_id        uuid references public.bookings(id) on delete set null,

  -- Revision tracking (Phase 5).
  revision_number             integer not null default 1,
  revision_note               text,

  -- Reminder tracking (Phase 6).
  last_reminder_at            timestamptz,
  reminder_count              integer not null default 0,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.quotes add constraint quotes_job_type_has_job_id
  check (quote_type <> 'job' or job_id is not null);
alter table public.quotes add constraint quotes_standalone_type_has_customer_id
  check (quote_type <> 'standalone' or customer_id is not null);

create table public.quote_items (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.quotes(id) on delete cascade,
  description  text not null,
  type         text not null check (type in ('part','labour','other')),
  quantity     numeric(10,2) not null default 1,
  unit_price   numeric(10,2) not null default 0,
  product_id   uuid references public.products(id) on delete set null,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create table public.quote_revisions (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid not null references public.quotes(id) on delete cascade,
  revision_number integer not null,
  note            text not null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  items_snapshot  jsonb
);

create index quotes_location_id_idx       on public.quotes(location_id);
create index quotes_organization_id_idx   on public.quotes(organization_id);
create index quotes_job_id_idx            on public.quotes(job_id) where job_id is not null;
create index quotes_customer_id_idx       on public.quotes(customer_id) where customer_id is not null;
create index quotes_status_idx            on public.quotes(status);
create index quotes_slug_idx              on public.quotes(slug) where slug is not null;
create index quote_items_quote_id_idx     on public.quote_items(quote_id);
create index quote_revisions_quote_id_idx on public.quote_revisions(quote_id);

-- updated_at touch trigger.
create or replace function public.quotes_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger quotes_touch_updated_at
  before update on public.quotes
  for each row execute function public.quotes_touch_updated_at();

-- View-counter RPC (token-gated public page calls this; SECURITY DEFINER so it
-- bumps the count without a public RLS write policy).
create or replace function public.quotes_increment_view(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.quotes
  set viewed_count = viewed_count + 1,
      viewed_at = coalesce(viewed_at, now())
  where id = p_id;
$$;
grant execute on function public.quotes_increment_view(uuid) to anon, authenticated;

-- RLS — staff (location members). Token-gated public access goes through the
-- service role / SECURITY DEFINER RPC, so no public policy is needed.
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_revisions enable row level security;

create policy "quotes_location_members" on public.quotes
  for all to authenticated
  using (private.is_location_member(location_id))
  with check (private.is_location_member(location_id));

create policy "quote_items_location_members" on public.quote_items
  for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and private.is_location_member(q.location_id)))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and private.is_location_member(q.location_id)));

create policy "quote_revisions_location_members" on public.quote_revisions
  for all to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_id and private.is_location_member(q.location_id)))
  with check (exists (select 1 from public.quotes q where q.id = quote_id and private.is_location_member(q.location_id)));

-- ── Backfill ────────────────────────────────────────────────────────────────
-- job_quotes → quotes (quote_type = 'job'). organization_id derived from the
-- location (job_quotes has no organization_id column).
insert into public.quotes (
  id, quote_type, organization_id, location_id, created_by,
  job_id, vehicle_id,
  title, description,
  video_path, video_mime, video_size_bytes, video_duration_seconds,
  subtotal, vat_rate, vat_amount, total,
  status, token_hash, slug,
  expires_at, sent_at, viewed_at, viewed_count, responded_at,
  approved_item_ids, applied_job_item_ids, decline_reason,
  deposit_pct, deposit_amount, deposit_required, deposit_paid_at,
  stripe_checkout_session_id, stripe_payment_intent_id,
  created_at, updated_at
)
select
  jq.id, 'job', l.organization_id, jq.location_id, jq.created_by,
  jq.job_id, null,
  jq.title, jq.description,
  jq.video_path, jq.video_mime, jq.video_size_bytes, jq.video_duration_seconds,
  jq.subtotal, coalesce(jq.vat_rate, 20), jq.vat_amount, jq.total,
  jq.status, jq.token_hash, jq.slug,
  jq.expires_at, jq.sent_at, jq.viewed_at, coalesce(jq.viewed_count, 0), jq.responded_at,
  jq.approved_item_ids, jq.applied_job_item_ids, jq.decline_reason,
  jq.deposit_pct, jq.deposit_amount, coalesce(jq.deposit_required, false), jq.deposit_paid_at,
  jq.stripe_checkout_session_id, jq.stripe_payment_intent_id,
  jq.created_at, jq.updated_at
from public.job_quotes jq
join public.locations l on l.id = jq.location_id;

insert into public.quote_items (id, quote_id, description, type, quantity, unit_price, product_id, sort_order, created_at)
select id, quote_id, description, type, quantity, unit_price, product_id, sort_order, created_at
from public.job_quote_items;

-- standalone_quotes → quotes (quote_type = 'standalone').
insert into public.quotes (
  id, quote_type, organization_id, location_id, created_by,
  customer_id, vehicle_id,
  title, description, customer_message,
  video_path, video_mime, video_size_bytes, video_duration_seconds,
  subtotal, vat_rate, vat_amount, total,
  status, token_hash, slug,
  expires_at, sent_at, viewed_at, viewed_count, responded_at,
  approved_item_ids, decline_reason,
  deposit_pct, deposit_amount, deposit_required, deposit_paid_at,
  stripe_checkout_session_id, stripe_payment_intent_id,
  converted_booking_id,
  created_at, updated_at
)
select
  sq.id, 'standalone', sq.organization_id, sq.location_id, sq.created_by,
  sq.customer_id, sq.vehicle_id,
  sq.title, sq.description, sq.customer_message,
  sq.video_path, sq.video_mime, sq.video_size_bytes, sq.video_duration_seconds,
  sq.subtotal, coalesce(sq.vat_rate, 20), sq.vat_amount, sq.total,
  sq.status, sq.token_hash, sq.slug,
  sq.expires_at, sq.sent_at, sq.viewed_at, coalesce(sq.viewed_count, 0), sq.responded_at,
  sq.approved_item_ids, sq.decline_reason,
  sq.deposit_pct, sq.deposit_amount, coalesce(sq.deposit_required, false), sq.deposit_paid_at,
  sq.stripe_checkout_session_id, sq.stripe_payment_intent_id,
  sq.converted_booking_id,
  sq.created_at, sq.updated_at
from public.standalone_quotes sq;

insert into public.quote_items (id, quote_id, description, type, quantity, unit_price, product_id, sort_order, created_at)
select id, quote_id, description, type, quantity, unit_price, product_id, sort_order, created_at
from public.standalone_quote_items;

-- ── Phase 6 org settings (added now for a stable schema) ─────────────────────
alter table public.organizations
  add column if not exists quote_reminder_days     integer[] default '{3,7}',
  add column if not exists quote_reminder_max      integer   default 2,
  add column if not exists quote_reminders_enabled boolean   default true,
  add column if not exists quote_validity_days     integer   default 30;

-- ── Mark old tables as read-only archives (dropped in Phase 10) ──────────────
comment on table public.job_quotes is 'ARCHIVED: migrated to public.quotes (quote_type=job). Read-only. Drop in Phase 10 (#252).';
comment on table public.standalone_quotes is 'ARCHIVED: migrated to public.quotes (quote_type=standalone). Read-only. Drop in Phase 10 (#252).';
