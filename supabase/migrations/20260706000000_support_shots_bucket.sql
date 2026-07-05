-- Private bucket for support-widget screenshots (ticket context attachments).
-- Mirrors 20260522000100_job_quote_videos_bucket.sql: NO storage policies are
-- added — absence denies anon/authenticated entirely; uploads happen through
-- service-role signed upload URLs and reads through short-TTL signed URLs
-- minted for the platform-admin ticket view (src/lib/support-shots.ts).
insert into storage.buckets (id, name, public)
values ('support-shots', 'support-shots', false)
on conflict (id) do nothing;
