-- Shareable signed-link gates for internal HTML docs.
-- A row represents one "link" sent to one or more external viewers.
-- Tokens are stored as sha256 hashes only; the raw token never persists.

create table if not exists public.doc_shares (
  id uuid primary key default gen_random_uuid(),

  -- Slug is the public-facing path segment in /docs/<slug>?t=...
  -- Random suffix ensures slugs are not guessable.
  slug text not null unique,

  -- Which HTML file to serve. Mapped to a file path in the route handler.
  -- e.g. "technical", "runbook", "architecture-v2".
  doc_key text not null,

  -- SHA-256 of the raw token, hex-encoded (64 chars). Never store the raw token.
  token_hash text not null,

  -- Human-readable label, shown only in the staff management UI.
  -- e.g. "Sent to CTO for review · 2026-05-20".
  label text,

  -- Hard expiry. NULL = never expires (not recommended).
  expires_at timestamptz,

  -- Optional view cap. NULL = unlimited.
  max_views int,
  view_count int not null default 0,

  -- Optional org scope. Platform-level shares have organization_id = NULL.
  organization_id uuid references public.organizations(id) on delete cascade,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,

  last_viewed_at timestamptz
);

create index if not exists doc_shares_org_idx
  on public.doc_shares (organization_id, created_at desc);

create index if not exists doc_shares_token_hash_idx
  on public.doc_shares (token_hash);

-- Atomic view-count increment + last_viewed_at stamp. Called from the
-- public route handler after a successful token verification. Done as a
-- function so multiple concurrent reads of the same link don't lose updates.
create or replace function public.doc_shares_increment_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.doc_shares
     set view_count = view_count + 1,
         last_viewed_at = now()
   where id = p_id
     and revoked_at is null
     and (expires_at is null or expires_at > now())
     and (max_views is null or view_count < max_views);
$$;

revoke all on function public.doc_shares_increment_view(uuid) from public;
grant execute on function public.doc_shares_increment_view(uuid) to service_role;

-- RLS — staff app reads/writes via the service role through server actions,
-- but defence-in-depth: deny anon/authenticated direct table access by default
-- and only allow org owners to see their org's rows.
alter table public.doc_shares enable row level security;

create policy "doc_shares_owner_select"
  on public.doc_shares for select
  using (
    organization_id is not null and exists (
      select 1 from public.org_users
       where user_id = auth.uid()
         and organization_id = doc_shares.organization_id
         and role in ('owner', 'admin')
    )
  );

create policy "doc_shares_owner_manage"
  on public.doc_shares for all
  using (
    organization_id is not null and exists (
      select 1 from public.org_users
       where user_id = auth.uid()
         and organization_id = doc_shares.organization_id
         and role = 'owner'
    )
  )
  with check (
    organization_id is not null and exists (
      select 1 from public.org_users
       where user_id = auth.uid()
         and organization_id = doc_shares.organization_id
         and role = 'owner'
    )
  );

-- Platform-level shares (organization_id IS NULL) are only manageable via
-- the service role from inside server actions — no policy grants access
-- to anon/authenticated for those rows.
