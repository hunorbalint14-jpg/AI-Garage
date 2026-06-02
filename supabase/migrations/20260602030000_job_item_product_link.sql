-- Link job line items to catalogue products (Phase 4 inventory). Nullable so
-- free-text parts/labour still work; when a part is linked to a product, stock
-- is decremented on job completion (and credited back on reopen). on delete set
-- null so deleting a product doesn't block or cascade-delete job history.

alter table public.job_items
  add column if not exists product_id uuid references public.products(id) on delete set null;

create index if not exists job_items_product_idx on public.job_items (product_id);
