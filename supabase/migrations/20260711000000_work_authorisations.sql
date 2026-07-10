-- Work authorisation artefacts (#503, docs/work-authorisation-build-spec.md,
-- PR 2). One immutable row per authorisation event: the itemised estimate and
-- the org T&Cs are SNAPSHOTTED as shown at signing, so later edits to items
-- or terms never rewrite what the customer agreed to. Staff RLS is
-- select+insert only — no update/delete policies (absence denies); lifecycle
-- writes (reauth links, PR 4) go through the admin client.

create table if not exists public.work_authorisations (
  id               uuid primary key default gen_random_uuid(),
  location_id      uuid not null references public.locations(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete cascade,
  job_id           uuid references public.jobs(id) on delete cascade,
  quote_id         uuid references public.quotes(id) on delete set null,
  customer_id      uuid references public.customers(id) on delete set null,
  kind             text not null check (kind in ('initial', 'variation')),
  method           text not null
                     check (method in ('counter_signature', 'quote_approval', 'reauth_link')),
  status           text not null default 'authorised'
                     check (status in ('pending', 'authorised', 'declined')),
  authorised_total numeric(10,2) not null,
  items_snapshot   jsonb not null,
  terms_snapshot   text,
  signature_path   text,
  signed_name      text,
  ip               text,
  user_agent       text,
  token_hash       text unique,
  slug             text unique,
  requested_at     timestamptz,
  authorised_at    timestamptz,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists work_authorisations_job_idx
  on public.work_authorisations (job_id, created_at desc);
create index if not exists work_authorisations_location_idx
  on public.work_authorisations (location_id);

create trigger set_org_from_location
  before insert on public.work_authorisations
  for each row execute function private.set_org_from_location();

alter table public.work_authorisations enable row level security;

-- Immutable to staff: read + create only. No update/delete policies.
create policy "work_authorisations_select" on public.work_authorisations
  for select to authenticated
  using (private.is_location_member(location_id));

create policy "work_authorisations_insert" on public.work_authorisations
  for insert to authenticated
  with check (private.is_location_member(location_id));

-- Org T&Cs (current, editable — artefacts snapshot their own copy) and the
-- variation threshold (PR 4).
alter table public.organizations
  add column if not exists authorisation_terms text,
  add column if not exists variation_threshold_pct numeric not null default 10;

-- Signature bucket: private, no storage policies (absence denies) — small
-- PNGs written server-side via the admin client, read via signed URLs.
insert into storage.buckets (id, name, public)
values ('authorisation-signatures', 'authorisation-signatures', false)
on conflict (id) do nothing;
