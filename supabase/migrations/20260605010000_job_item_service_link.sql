-- Link job line items to the services catalogue (Phase 6 PR3b groundwork).
-- job_items previously copied a service's name/price but kept no reference, so
-- there was no reliable way to tell "this invoice line is the included MOT".
-- Adds an optional service_id (mirrors the existing product_id link) so the
-- upcoming plan included-services allowance can match consumed services.

alter table public.job_items
  add column if not exists service_id uuid references public.services(id) on delete set null;

create index if not exists job_items_service_idx on public.job_items (service_id);
