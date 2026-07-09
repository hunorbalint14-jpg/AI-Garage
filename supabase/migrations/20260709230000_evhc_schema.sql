-- eVHC Phase 1 (#497, docs/evhc-build-spec.md): inspections data model.
-- Templates are ORG-scoped catalogue data (like service_plans); inspections,
-- their items and media are per-branch OPERATIONAL data (like jobs). The
-- customer-facing approval rail is the existing unified quotes table —
-- quote_items gains an inspection_item_id backlink, nothing else changes.

-- ── Templates (org-wide checklist catalogue) ────────────────────────────────

create table if not exists public.inspection_templates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists inspection_templates_org_idx
  on public.inspection_templates (organization_id);

create table if not exists public.inspection_template_items (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.inspection_templates(id) on delete cascade,
  section     text not null,
  label       text not null,
  sort_order  integer not null default 0
);

create index if not exists inspection_template_items_template_idx
  on public.inspection_template_items (template_id);

-- ── Inspections (per-branch operational) ────────────────────────────────────

create table if not exists public.inspections (
  id              uuid primary key default gen_random_uuid(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  template_id     uuid references public.inspection_templates(id) on delete set null,
  performed_by    uuid references auth.users(id) on delete set null,
  status          text not null default 'draft'
                    check (status in ('draft', 'in_progress', 'complete', 'sent')),
  -- The generated unified quote for red/amber findings (Phase 4).
  quote_id        uuid references public.quotes(id) on delete set null,
  -- Customer report gate (Phase 5) — sha256(token) only, minted on send.
  token_hash      text unique,
  slug            text unique,
  sent_at         timestamptz,
  viewed_at       timestamptz,
  viewed_count    integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists inspections_location_idx on public.inspections (location_id);
create index if not exists inspections_job_idx on public.inspections (job_id);
create index if not exists inspections_vehicle_idx on public.inspections (vehicle_id);

-- organization_id backfilled from location_id on insert (shared trigger fn).
create trigger set_org_from_location
  before insert on public.inspections
  for each row execute function private.set_org_from_location();

create table if not exists public.inspection_items (
  id               uuid primary key default gen_random_uuid(),
  inspection_id    uuid not null references public.inspections(id) on delete cascade,
  template_item_id uuid references public.inspection_template_items(id) on delete set null,
  -- Snapshot from the template so later template edits can't rewrite a sent
  -- report; null template_item_id = ad-hoc finding.
  section          text not null,
  label            text not null,
  rag              text not null default 'not_checked'
                     check (rag in ('green', 'amber', 'red', 'not_checked')),
  note             text,              -- tech shorthand
  customer_summary text,              -- AI rewrite / manual edit (Phase 3)
  outcome          text not null default 'none'
                     check (outcome in ('none', 'quoted', 'approved', 'declined')),
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists inspection_items_inspection_idx
  on public.inspection_items (inspection_id);
-- The deferred-work bank (#498) queries declined/unquoted amber+red findings.
create index if not exists inspection_items_outcome_idx
  on public.inspection_items (outcome) where outcome <> 'none';

create table if not exists public.inspection_media (
  id                 uuid primary key default gen_random_uuid(),
  inspection_item_id uuid not null references public.inspection_items(id) on delete cascade,
  storage_path       text not null,
  mime               text,
  size_bytes         bigint,
  created_at         timestamptz not null default now()
);

create index if not exists inspection_media_item_idx
  on public.inspection_media (inspection_item_id);

-- Quote lines link back to the finding they price (Phase 4; feeds outcomes).
alter table public.quote_items
  add column if not exists inspection_item_id uuid
    references public.inspection_items(id) on delete set null;

create index if not exists quote_items_inspection_item_idx
  on public.quote_items (inspection_item_id)
  where inspection_item_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.inspection_templates enable row level security;
alter table public.inspection_template_items enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_items enable row level security;
alter table public.inspection_media enable row level security;

-- Templates: readable by anyone employed in the org; managed by owner/admin.
create policy "inspection_templates_select" on public.inspection_templates
  for select to authenticated
  using (private.is_org_staff(organization_id));

create policy "inspection_templates_write" on public.inspection_templates
  for all to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));

create policy "inspection_template_items_select" on public.inspection_template_items
  for select to authenticated
  using (exists (
    select 1 from public.inspection_templates t
    where t.id = template_id and private.is_org_staff(t.organization_id)
  ));

create policy "inspection_template_items_write" on public.inspection_template_items
  for all to authenticated
  using (exists (
    select 1 from public.inspection_templates t
    where t.id = template_id and private.is_org_admin(t.organization_id)
  ))
  with check (exists (
    select 1 from public.inspection_templates t
    where t.id = template_id and private.is_org_admin(t.organization_id)
  ));

-- Inspections + children: branch members (branch staff + org owner/admin).
-- Customer report access never touches these policies — it goes through
-- server routes with the admin client + token check (quote/[slug] pattern).
create policy "inspections_all" on public.inspections
  for all to authenticated
  using (private.is_location_member(location_id))
  with check (private.is_location_member(location_id));

create policy "inspection_items_all" on public.inspection_items
  for all to authenticated
  using (exists (
    select 1 from public.inspections i
    where i.id = inspection_id and private.is_location_member(i.location_id)
  ))
  with check (exists (
    select 1 from public.inspections i
    where i.id = inspection_id and private.is_location_member(i.location_id)
  ));

create policy "inspection_media_all" on public.inspection_media
  for all to authenticated
  using (exists (
    select 1 from public.inspection_items it
    join public.inspections i on i.id = it.inspection_id
    where it.id = inspection_item_id and private.is_location_member(i.location_id)
  ))
  with check (exists (
    select 1 from public.inspection_items it
    join public.inspections i on i.id = it.inspection_id
    where it.id = inspection_item_id and private.is_location_member(i.location_id)
  ));

-- ── Media bucket ────────────────────────────────────────────────────────────
-- Private; NO storage policies (absence denies anon/authenticated) — uploads
-- via service-role signed upload URLs, reads via short-TTL signed URLs. Same
-- recipe as support-shots / job-quote-videos.
insert into storage.buckets (id, name, public)
values ('inspection-media', 'inspection-media', false)
on conflict (id) do nothing;

-- ── Default template seed ───────────────────────────────────────────────────
-- One "Standard health check" per org (~33 items). SECURITY DEFINER in public
-- so the signup flow can RPC it for new orgs (service-role only, like
-- next_document_number); idempotent on (organization_id, name).

create or replace function public.seed_default_inspection_template(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template_id uuid;
begin
  select id into v_template_id
  from public.inspection_templates
  where organization_id = p_organization_id and name = 'Standard health check';
  if v_template_id is not null then
    return v_template_id;
  end if;

  insert into public.inspection_templates (organization_id, name)
  values (p_organization_id, 'Standard health check')
  returning id into v_template_id;

  insert into public.inspection_template_items (template_id, section, label, sort_order)
  select v_template_id, s, l, ord
  from (values
    ('Wheels & tyres',        'NSF tyre condition & tread depth',        10),
    ('Wheels & tyres',        'OSF tyre condition & tread depth',        20),
    ('Wheels & tyres',        'NSR tyre condition & tread depth',        30),
    ('Wheels & tyres',        'OSR tyre condition & tread depth',        40),
    ('Wheels & tyres',        'Spare wheel / inflation kit',             50),
    ('Wheels & tyres',        'Wheel condition (rims & fixings)',        60),
    ('Brakes',                'Front pads & discs',                      70),
    ('Brakes',                'Rear pads/shoes & discs/drums',           80),
    ('Brakes',                'Brake pipes & hoses',                     90),
    ('Brakes',                'Handbrake operation',                    100),
    ('Brakes',                'Brake fluid level & condition',          110),
    ('Steering & suspension', 'Steering rack, joints & gaiters',        120),
    ('Steering & suspension', 'Front suspension arms & bushes',         130),
    ('Steering & suspension', 'Rear suspension & springs',              140),
    ('Steering & suspension', 'Shock absorbers (leaks / bounce)',       150),
    ('Steering & suspension', 'Wheel bearings (noise / play)',          160),
    ('Underside',             'Exhaust system & mounts',                170),
    ('Underside',             'Underbody corrosion',                    180),
    ('Underside',             'Fuel & brake line condition',            190),
    ('Underside',             'Driveshafts & CV boots',                 200),
    ('Under bonnet',          'Engine oil level & condition',           210),
    ('Under bonnet',          'Coolant level & leaks',                  220),
    ('Under bonnet',          'Drive belts condition',                  230),
    ('Under bonnet',          'Battery condition & terminals',          240),
    ('Under bonnet',          'Power steering fluid',                   250),
    ('Under bonnet',          'Screenwash top-up',                      260),
    ('Lights & electrics',    'Exterior lights operation',              270),
    ('Lights & electrics',    'Dashboard warning lights',               280),
    ('Lights & electrics',    'Horn operation',                         290),
    ('Lights & electrics',    'Wipers & washers',                       300),
    ('Interior & visibility', 'Windscreen chips / cracks',              310),
    ('Interior & visibility', 'Mirrors condition',                      320),
    ('Interior & visibility', 'Seatbelt condition & operation',         330)
  ) as t(s, l, ord);

  return v_template_id;
end;
$$;

revoke execute on function public.seed_default_inspection_template(uuid) from public, anon, authenticated;
grant execute on function public.seed_default_inspection_template(uuid) to service_role;

-- Backfill every existing org.
select public.seed_default_inspection_template(id) from public.organizations;
