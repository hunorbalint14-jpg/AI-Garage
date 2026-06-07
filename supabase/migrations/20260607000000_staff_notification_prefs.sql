-- Per-user staff notification preferences. One row per auth user; absence of a
-- row means "all defaults on". Extensible — add a column per togglable channel.
create table if not exists public.staff_notification_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly_digest boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.staff_notification_prefs enable row level security;

-- A user manages only their own preferences. Server senders use the service
-- role (admin client), which bypasses RLS.
create policy "staff_notification_prefs_select_own"
  on public.staff_notification_prefs for select
  using (auth.uid() = user_id);

create policy "staff_notification_prefs_insert_own"
  on public.staff_notification_prefs for insert
  with check (auth.uid() = user_id);

create policy "staff_notification_prefs_update_own"
  on public.staff_notification_prefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
