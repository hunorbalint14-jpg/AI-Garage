-- Single-use ledger for password-reset tokens. Each issued reset token carries
-- a random `jti`; consuming a token inserts its jti here. A second attempt to
-- use the same token hits the primary-key conflict and is rejected, so a reset
-- link works exactly once (within its short TTL) even if replayed.
--
-- This is auth-infrastructure, not tenant data: rows are written/read only by
-- the service-role admin client (which bypasses RLS). RLS is enabled with NO
-- policies so any anon/authenticated access is denied by default.

create table if not exists public.password_reset_tokens (
  jti         text primary key,
  user_id     uuid not null,
  consumed_at timestamptz not null default now(),
  expires_at  timestamptz not null
);

-- Lets a periodic cleanup prune expired rows efficiently.
create index if not exists password_reset_tokens_expires_at_idx
  on public.password_reset_tokens (expires_at);

alter table public.password_reset_tokens enable row level security;
-- No policies: deny all to anon/authenticated. Service role bypasses RLS.
