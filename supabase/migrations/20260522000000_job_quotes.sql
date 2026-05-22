-- Digital Vehicle Inspection (DVI) / mid-job upsell quotes.
-- A mechanic records a short video showing extra work found on a job,
-- attaches line items + total, and sends the customer a token-gated link
-- to approve or decline. Approved items get copied into job_items.

create table if not exists public.job_quotes (
  id uuid primary key default gen_random_uuid(),

  -- Parent job. Cascade so deleting a job cleans up its quotes + items.
  job_id uuid not null references public.jobs(id) on delete cascade,

  -- Denormalised for RLS scoping (mirrors job_items/jobs pattern).
  location_id uuid not null references public.locations(id) on delete cascade,

  created_by uuid references auth.users(id) on delete set null,

  -- Optional customer-facing title (e.g. "Worn front brake pads").
  title text,

  -- Mechanic's explanation shown to the customer above the line items.
  description text,

  -- Storage object key in the job-quote-videos bucket (private).
  -- Format: {location_id}/{job_id}/{quote_id}.{ext}
  video_path text not null,
  video_mime text,
  video_size_bytes integer,
  video_duration_seconds integer,

  -- Computed totals (UK 20% VAT).
  subtotal numeric(10,2) not null default 0,
  vat_rate numeric(5,2) not null default 20,
  vat_amount numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,

  -- Lifecycle:
  --   pending           — sent, awaiting customer response
  --   approved          — customer approved, items copied to job_items
  --   declined          — customer explicitly declined
  --   rebooked          — customer chose to book a separate appointment (v2)
  --   expired           — passed expires_at without a response
  --   cancelled         — staff cancelled before customer responded
  --   approved_after_close — customer approved but job was already closed
  status text not null default 'pending'
    check (status in ('pending','approved','declined','rebooked','expired','cancelled','approved_after_close')),

  -- Token gating (same pattern as doc_shares: sha256 hash stored, raw token only in URL).
  token_hash text not null,
  slug text not null unique,

  -- Hard expiry. Defaults to 7 days from creation (set at insert time by app).
  expires_at timestamptz not null,

  sent_at timestamptz,
  viewed_at timestamptz,
  viewed_count integer not null default 0,

  responded_at timestamptz,
  -- Subset of job_quote_items the customer ticked (v2 partial approval).
  -- Empty array + status=approved means all items approved.
  approved_item_ids uuid[] not null default '{}',
  -- Job_items rows created on approve, so we can untangle on revoke.
  applied_job_item_ids uuid[] not null default '{}',
  decline_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_quotes_job_idx
  on public.job_quotes (job_id, created_at desc);
create index if not exists job_quotes_location_idx
  on public.job_quotes (location_id, created_at desc);
create index if not exists job_quotes_token_hash_idx
  on public.job_quotes (token_hash);
create index if not exists job_quotes_pending_idx
  on public.job_quotes (expires_at)
  where status = 'pending';

-- Snapshot of the items quoted to the customer. Frozen at send time so
-- staff edits to products afterwards don't change what the customer agreed to.
create table if not exists public.job_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.job_quotes(id) on delete cascade,

  description text not null,
  type text not null check (type in ('part','labour','other')),
  quantity numeric(10,2) not null,
  unit_price numeric(10,2) not null,

  -- Optional link back to the product (nullable; product may be deleted later).
  product_id uuid references public.products(id) on delete set null,

  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists job_quote_items_quote_idx
  on public.job_quote_items (quote_id, sort_order);

-- Atomic view increment + first-view stamp. Mirrors doc_shares_increment_view.
create or replace function public.job_quotes_increment_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.job_quotes
     set viewed_count = viewed_count + 1,
         viewed_at = coalesce(viewed_at, now()),
         updated_at = now()
   where id = p_id
     and status = 'pending'
     and expires_at > now();
$$;

revoke all on function public.job_quotes_increment_view(uuid) from public;
grant execute on function public.job_quotes_increment_view(uuid) to service_role;

-- updated_at touch trigger.
create or replace function public.touch_job_quotes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists job_quotes_touch_updated_at on public.job_quotes;
create trigger job_quotes_touch_updated_at
  before update on public.job_quotes
  for each row execute function public.touch_job_quotes_updated_at();

-- RLS: staff can read/write their own location's quotes. Customer access
-- happens via service-role through the public /quote/[slug] route, not
-- through these policies.
alter table public.job_quotes enable row level security;
alter table public.job_quote_items enable row level security;

create policy "job_quotes_member_all"
  on public.job_quotes for all
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));

create policy "job_quote_items_member_all"
  on public.job_quote_items for all
  using (
    exists (
      select 1 from public.job_quotes q
       where q.id = job_quote_items.quote_id
         and public.is_location_member(q.location_id)
    )
  )
  with check (
    exists (
      select 1 from public.job_quotes q
       where q.id = job_quote_items.quote_id
         and public.is_location_member(q.location_id)
    )
  );
