-- CSAT pulse upgrades (#508). New 'suppressed' status for review requests
-- skipped by the frequency cap (a customer pulsed within the last 30 days
-- isn't asked again for a repeat visit) — distinct from 'failed' so the
-- response-rate maths and the audit trail stay honest.

alter table public.review_requests drop constraint if exists review_requests_status_check;
alter table public.review_requests add constraint review_requests_status_check
  check (status in ('queued', 'sent', 'responded', 'failed', 'suppressed'));

-- The pulse cap + CSAT widget both scan by customer / recency.
create index if not exists review_requests_customer_idx
  on public.review_requests (customer_id, sent_at desc);
