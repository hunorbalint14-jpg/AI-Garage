-- Reminder engine: track every MOT/service reminder sent to a customer.
-- Also adds a phone number field to organizations so reminders can include
-- a "call us on X to book in" line.

alter table public.organizations add column if not exists phone text;

create table public.reminders (
  id uuid primary key default uuid_generate_v4(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  type text not null check (type in ('mot', 'service', 'general')),
  channel text not null default 'email' check (channel in ('email', 'sms')),
  recipient_email text not null,
  subject text not null,
  message_text text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error_message text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index reminders_customer_idx on public.reminders (customer_id);
create index reminders_vehicle_idx on public.reminders (vehicle_id);
create index reminders_location_idx on public.reminders (location_id);
create index reminders_sent_at_idx on public.reminders (sent_at desc);

alter table public.reminders enable row level security;

create policy "reminders_member_all"
  on public.reminders for all
  using (public.is_location_member(location_id))
  with check (public.is_location_member(location_id));
