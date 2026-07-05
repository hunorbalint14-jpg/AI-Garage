-- In-app support tickets + feature requests (tenant staff <-> platform ops).
-- Org-scoped: any staff member of the org reads the org's tickets — feature
-- requests stay private per-org (no cross-tenant board in v1). All writes go
-- through service-role server actions (zero write policies), matching
-- courtesy_cars / feature_flags.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Branch context at raise time; the ticket survives branch deletion.
  location_id uuid references public.locations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  -- Snapshots so the thread + email fan-out survive user deletion/rename.
  requester_name text,
  requester_email text,
  type text not null check (type in ('bug', 'question', 'feature_request')),
  -- Single vocabulary for all types; planned/declined are only OFFERED for
  -- feature requests (enforced in src/lib/support-tickets.ts, not here).
  status text not null default 'open'
    check (status in ('open', 'needs_info', 'in_progress', 'planned', 'resolved', 'closed', 'declined')),
  priority text not null default 'p3' check (priority in ('p1', 'p2', 'p3', 'p4')),
  subject text not null check (char_length(subject) between 3 and 150),
  -- Auto-captured intake context: org_slug, branch_name, org_role,
  -- location_role, path, user_agent, app_version (git sha).
  context jsonb not null default '{}'::jsonb,
  assigned_to uuid references auth.users(id) on delete set null, -- schema-ready; no v1 UI
  first_response_at timestamptz, -- first public platform reply (SLA metric later)
  resolved_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists support_tickets_org_idx
  on public.support_tickets (organization_id, last_activity_at desc);
-- Admin queue: filter by status, newest activity first.
create index if not exists support_tickets_queue_idx
  on public.support_tickets (status, last_activity_at desc);

alter table public.support_tickets enable row level security;

create policy "support_tickets_org_read" on public.support_tickets
  for select to authenticated
  using (private.is_org_staff(organization_id));

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  -- Denormalised from the ticket so the RLS check needs no join.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  author_kind text not null check (author_kind in ('staff', 'platform_admin')),
  author_name text,
  -- Platform-admin-only notes: excluded by the select policy below, so staff
  -- can NEVER read them regardless of app-layer bugs.
  internal boolean not null default false,
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_ticket_messages enable row level security;

create policy "support_ticket_messages_org_read" on public.support_ticket_messages
  for select to authenticated
  using (private.is_org_staff(organization_id) and internal = false);
