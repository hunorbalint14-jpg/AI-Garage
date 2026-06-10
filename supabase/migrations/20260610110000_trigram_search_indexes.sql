-- Trigram indexes for the staff customer search (and the upcoming typeahead
-- pickers). The search runs `ilike '%q%'` on these columns — a leading
-- wildcard can't use a btree, so every keystroke seq-scans the location's
-- rows. GIN + pg_trgm serves infix ilike directly.

create extension if not exists pg_trgm;

create index if not exists customers_full_name_trgm_idx
  on public.customers using gin (full_name gin_trgm_ops);

create index if not exists customers_phone_trgm_idx
  on public.customers using gin (phone gin_trgm_ops);

create index if not exists vehicles_registration_trgm_idx
  on public.vehicles using gin (registration gin_trgm_ops);
