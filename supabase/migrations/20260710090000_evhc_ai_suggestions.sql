-- eVHC Phase 3 (#497): AI findings rewrite. customer_summary already exists on
-- inspection_items (Phase 1); these columns hold the suggested repair line the
-- AI matches against the org's services/products catalogue. Phase 4 prefills
-- the generated quote line from them (price snapshot + catalogue refs for the
-- per-line VAT treatment lookup, #514 model).

alter table public.inspection_items
  add column if not exists suggested_repair text,
  add column if not exists suggested_price numeric(10,2),
  add column if not exists suggested_service_id uuid
    references public.services(id) on delete set null,
  add column if not exists suggested_product_id uuid
    references public.products(id) on delete set null;
