-- Courtesy cars phase 2: condition photos at check-out/return. (Job linkage
-- needs no schema — courtesy_car_loans.job_id shipped in phase 1.)

alter table public.courtesy_car_loans
  -- Storage object keys in the courtesy-car-photos bucket.
  add column if not exists photos_out text[] not null default '{}',
  add column if not exists photos_in text[] not null default '{}';

-- Private bucket, same access model as job-quote-videos: no storage RLS
-- policies — all access via service-role signed URLs (upload minted by the
-- staff action, short-TTL reads minted by the staff page).
insert into storage.buckets (id, name, public)
values ('courtesy-car-photos', 'courtesy-car-photos', false)
on conflict (id) do nothing;
