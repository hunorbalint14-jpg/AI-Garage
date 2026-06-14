-- The org's primary/default branch. Until now "primary" was *guessed*
-- (alphabetically-first in tenant-data.ts / staff-context.ts, oldest-created in
-- the admin impersonation route). Store it explicitly so owner/admin can set it
-- and every surface agrees. Nullable: code falls back to the alphabetical-first
-- branch when unset (e.g. a freshly-created org before anyone picks one).
alter table public.organizations
  add column if not exists primary_location_id uuid references public.locations(id) on delete set null;

-- Backfill to today's behaviour: the alphabetically-first location per org.
update public.organizations o
set primary_location_id = sub.id
from (
  select distinct on (organization_id) organization_id, id
  from public.locations
  order by organization_id, name asc
) sub
where sub.organization_id = o.id
  and o.primary_location_id is null;
