-- Mini-site gallery bucket (#507 PR 4). Public read (the photos are on a
-- public marketing page); writes go through the owner-gated server action
-- with the service role, so no storage RLS write policies are needed.
insert into storage.buckets (id, name, public)
values ('site-gallery', 'site-gallery', true)
on conflict (id) do nothing;
