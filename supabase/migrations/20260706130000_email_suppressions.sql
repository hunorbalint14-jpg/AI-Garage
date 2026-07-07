-- #444 email deliverability: a suppression list so we stop emailing dead
-- inboxes (hard bounces) and people who marked us as spam (complaints).
-- Populated by the Resend webhook (/api/webhooks/resend); checked at send time
-- in src/lib/email.ts. Keyed on the lowercased address and GLOBAL (not
-- tenant-scoped): every tenant sends through the same Resend domain, so its
-- deliverability reputation is shared — a hard bounce or complaint anywhere
-- means we must stop sending to that address everywhere.

create table if not exists public.email_suppressions (
  email text primary key,                                   -- lowercased recipient
  reason text not null check (reason in ('hard_bounce', 'complaint')),
  detail text,                                              -- provider subtype / message
  resend_email_id text,                                     -- the send that triggered it
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.email_suppressions enable row level security;

-- Platform-operational data: only platform admins may read it (for a future
-- admin view / support). The Resend webhook and the send-time check both use
-- the service-role client, which bypasses RLS — so there is deliberately no
-- insert/update/delete policy. No tenant access.
create policy "email_suppressions_select_platform_admin"
  on public.email_suppressions for select
  to authenticated
  using (private.is_platform_admin());

grant select on public.email_suppressions to authenticated;
grant all on public.email_suppressions to service_role;
