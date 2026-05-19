-- Structured audit log for staff actions in /staff/settings, payment
-- connections (Stripe / Xero), DPA acceptance, impersonation start/stop
-- and anything else worth a forensic trail. Append-only — no UPDATE/DELETE
-- policy exists, so rows can't be tampered with after the fact through the
-- normal app surface.

create table if not exists public.audit_log (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_created_idx
  on public.audit_log (organization_id, created_at desc);
create index if not exists audit_log_actor_idx
  on public.audit_log (actor_user_id, created_at desc);
create index if not exists audit_log_action_idx
  on public.audit_log (action, created_at desc);

alter table public.audit_log enable row level security;

-- Org owners + admins can read their own org's audit trail. Platform-scoped
-- rows (organization_id IS NULL) are only readable via the service role.
create policy "audit_log_owner_read"
  on public.audit_log for select
  using (
    organization_id is not null
    and exists (
      select 1 from public.org_users
       where user_id = auth.uid()
         and organization_id = audit_log.organization_id
         and role in ('owner', 'admin')
    )
  );

-- INSERT happens exclusively from server actions via the admin client
-- (service role bypasses RLS), so no INSERT policy is granted to
-- authenticated/anon. UPDATE + DELETE have no policy at all → fully locked.
