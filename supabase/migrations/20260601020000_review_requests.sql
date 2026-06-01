-- Post-job review funnel. A queued row is created when a job is marked complete
-- (no token yet). The daily /api/cron/review-requests job mints a token, stores
-- its sha256 hash, and emails the customer a link to /review/[token]. The
-- customer's rating routes ≥4★ to the garage's Google review URL and <4★ to a
-- private channel that alerts staff.
--
-- token_hash is nullable (null while queued) and set when the email is sent, so
-- the raw token is only ever held transiently at send time — never stored.
-- The scheduled_tasks.task_type CHECK already allows 'review_requests' (added by
-- the invoice_dunning migration).

create table if not exists public.review_requests (
  id              uuid primary key default uuid_generate_v4(),
  location_id     uuid not null references public.locations(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  job_id          uuid not null references public.jobs(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete set null,
  token_hash      text unique,
  status          text not null default 'queued' check (status in ('queued', 'sent', 'responded', 'failed')),
  score           int check (score between 1 and 5),
  feedback_text   text,
  channel         text not null default 'email',
  sent_at         timestamptz,
  responded_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists review_requests_status_idx on public.review_requests (status);
create index if not exists review_requests_job_idx on public.review_requests (job_id);

alter table public.review_requests enable row level security;

-- Staff can read their location's review requests (a dashboard may surface them
-- later). All writes happen via the service-role admin client (enqueue on job
-- completion, the send cron, and the token-gated public submit) which bypasses RLS.
create policy "review_requests_member_read"
  on public.review_requests for select
  using (public.is_location_member(location_id));
