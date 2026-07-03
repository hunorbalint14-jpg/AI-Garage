-- Re-add organizations.primary_location_id → locations FK.
--
-- The constraint was dropped BY HAND in prod on 2026-06-15 as the emergency
-- mitigation for the PGRST201 embed-ambiguity outage (a second org↔locations
-- relationship makes every unhinted embed between the two tables error).
-- All embeds in both directions have been FK-hinted since PR #354 (5 sites,
-- organizations→locations) and PR #391 (25 sites, locations→organizations),
-- so the second relationship is safe to restore.
--
-- Guarded: fresh databases already have the constraint from 20260614200000's
-- inline REFERENCES, so this only acts on drifted environments (prod).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_primary_location_id_fkey'
      and conrelid = 'public.organizations'::regclass
  ) then
    -- Null any dangling pointers first so the constraint can validate
    -- (possible while the FK was absent, e.g. a deleted location).
    update public.organizations o
    set primary_location_id = null
    where o.primary_location_id is not null
      and not exists (
        select 1 from public.locations l where l.id = o.primary_location_id
      );

    alter table public.organizations
      add constraint organizations_primary_location_id_fkey
      foreign key (primary_location_id)
      references public.locations (id)
      on delete set null;
  end if;
end $$;
