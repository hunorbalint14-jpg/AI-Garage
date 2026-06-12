-- AI receptionist / missed-call capture (Tier 1 roadmap, premium tier).
-- Each enabled location gets a dedicated Twilio number; the inbound `To`
-- number is the routing key from webhook to garage. Voice calls forward to
-- the garage's real phone, and on no-answer the agent texts the caller back
-- and books them over SMS/WhatsApp using real bay availability.

create table if not exists public.receptionist_configs (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references public.locations(id) on delete cascade,
  enabled boolean not null default false,
  -- E.164. The Twilio number customers call/text; inbound routing key.
  twilio_number text unique,
  -- The garage's actual phone — voice calls try here first.
  forward_to_phone text,
  -- Seconds to ring the forward number before the agent takes over.
  forward_timeout_seconds smallint not null default 20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.receptionist_configs enable row level security;
create policy "receptionist_configs_member_read" on public.receptionist_configs
  for select to authenticated using (private.is_location_member(location_id));

-- One row per customer conversation thread. Transcript lives inline as a
-- jsonb array of {role, content, at} — receptionist threads are short and
-- read as a unit, so a per-message table buys nothing.
create table if not exists public.receptionist_conversations (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_phone text not null,
  channel text not null default 'sms' check (channel in ('sms', 'whatsapp')),
  status text not null default 'active'
    check (status in ('active', 'completed', 'handed_off', 'expired')),
  source text not null default 'inbound_message'
    check (source in ('inbound_message', 'missed_call')),
  customer_id uuid references public.customers(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  messages jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- Webhook lookup: the active thread for a phone number at a location.
create index if not exists receptionist_conversations_lookup_idx
  on public.receptionist_conversations (location_id, customer_phone, last_message_at desc);

alter table public.receptionist_conversations enable row level security;
create policy "receptionist_conversations_member_read" on public.receptionist_conversations
  for select to authenticated using (private.is_location_member(location_id));
