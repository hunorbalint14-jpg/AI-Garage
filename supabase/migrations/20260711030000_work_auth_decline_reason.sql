-- #503 PR 4: customers can decline a re-authorisation request with a reason
-- — staff need it verbatim when they call back.

alter table public.work_authorisations
  add column if not exists declined_reason text;
