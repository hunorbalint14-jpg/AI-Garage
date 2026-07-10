-- Job profitability (#502, PR 1). Two gaps in the raw data:
--
-- 1. job_items never snapshotted the part's COST — margin needs sell vs cost
--    at the time the line was written (a later catalogue price change must
--    not rewrite an invoiced job's margin). New unit_cost column, filled at
--    line creation from products.cost_price; backfilled from the CURRENT
--    cost_price for existing product-linked lines (best available proxy —
--    flagged as such in the UI copy). Null = unknown, never guessed.
--
-- 2. No labour cost rate exists anywhere. Org-level £/hour
--    (organizations.labour_cost_rate, null = not configured → labour cost
--    and GP render as unknown rather than a made-up number).

alter table public.job_items
  add column if not exists unit_cost numeric(10,2);

update public.job_items ji
   set unit_cost = p.cost_price
  from public.products p
 where p.id = ji.product_id
   and ji.unit_cost is null
   and p.cost_price is not null;

alter table public.organizations
  add column if not exists labour_cost_rate numeric(10,2);
