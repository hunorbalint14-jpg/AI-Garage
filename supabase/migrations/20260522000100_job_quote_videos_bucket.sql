-- Private storage bucket for DVI / quote diagnosis videos.
-- All access goes through service-role server actions (signed URLs minted
-- by the staff app for upload, signed read URLs minted by the customer
-- /quote/[slug] route at 30-min TTL). No client RLS policies are added —
-- the absence of any policy denies anon/authenticated by default.

insert into storage.buckets (id, name, public)
values ('job-quote-videos', 'job-quote-videos', false)
on conflict (id) do nothing;
