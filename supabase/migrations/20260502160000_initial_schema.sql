-- Initial schema for Garage-AI
-- Tenant model: each garage is a tenant. Staff and customers are linked through join tables.

create extension if not exists "uuid-ossp";

create table public.garages (
  id uuid primary key default uuid_generate_v4(),
  slug text not null unique,
  name text not null,
  logo_url text,
  primary_color text not null default '#1f2937',
  custom_domain text unique,
  created_at timestamptz not null default now()
);

create table public.garage_users (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  garage_id uuid not null references public.garages(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (user_id, garage_id)
);

create table public.customers (
  id uuid primary key default uuid_generate_v4(),
  garage_id uuid not null references public.garages(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  phone text,
  full_name text,
  created_at timestamptz not null default now(),
  unique (garage_id, email)
);

create table public.vehicles (
  id uuid primary key default uuid_generate_v4(),
  garage_id uuid not null references public.garages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  registration text not null,
  make text,
  model text,
  year integer,
  mot_expiry date,
  service_due date,
  created_at timestamptz not null default now(),
  unique (garage_id, registration)
);

create index garage_users_user_idx on public.garage_users (user_id);
create index garage_users_garage_idx on public.garage_users (garage_id);
create index customers_garage_idx on public.customers (garage_id);
create index customers_user_idx on public.customers (user_id);
create index vehicles_garage_idx on public.vehicles (garage_id);
create index vehicles_customer_idx on public.vehicles (customer_id);
