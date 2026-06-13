-- Generalize finance_applications from quote-only to any payable subject so
-- "Spread the cost" can run against invoices too, not just quotes. The table
-- shipped yesterday (20260612180000) and only the quote-finance code reads
-- these columns, so renaming in place is safe and keeps the model honest
-- (no quote-named columns holding invoice ids).

alter table public.finance_applications rename column quote_source to subject_type;
alter table public.finance_applications rename column quote_id   to subject_id;
alter table public.finance_applications rename column quote_slug to subject_ref;

-- Invoices have no slug/token to bounce back to (the portal route is
-- id-addressed + auth-gated), so subject_ref is now optional.
alter table public.finance_applications alter column subject_ref drop not null;

-- Widen the subject vocabulary: 'job' | 'standalone' (quotes) + 'invoice'.
alter table public.finance_applications
  drop constraint if exists finance_applications_quote_source_check;
alter table public.finance_applications
  add constraint finance_applications_subject_type_check
  check (subject_type in ('job', 'standalone', 'invoice'));

alter index if exists finance_applications_quote_idx
  rename to finance_applications_subject_idx;
