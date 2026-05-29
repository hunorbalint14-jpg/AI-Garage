-- Team roles, custom profiles & permission enforcement.
-- Adds the missing permissions JSONB column to location_users (UI saved it
-- but no migration existed), extends the role taxonomy to UK garage norms,
-- adds MOT tester / QC reviewer flags, and introduces role_templates (system
-- + custom) so owners can manage named permission profiles.

------------------------------------------------------------
-- 1. location_users additions
------------------------------------------------------------

alter table public.location_users
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists mot_tester boolean not null default false,
  add column if not exists mot_qc_reviewer boolean not null default false,
  add column if not exists template_id uuid;

------------------------------------------------------------
-- 2. Expanded role taxonomy
------------------------------------------------------------

alter table public.location_users
  drop constraint if exists location_users_role_check;

alter table public.location_users
  add constraint location_users_role_check
    check (role in (
      'manager','service_advisor','mechanic','apprentice',
      'receptionist','parts','bookkeeper','staff'
    ));

------------------------------------------------------------
-- 3. role_templates table
------------------------------------------------------------

create table if not exists public.role_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  permissions jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists role_templates_org_idx
  on public.role_templates (organization_id, sort_order);

alter table public.location_users
  add constraint location_users_template_fk
    foreign key (template_id) references public.role_templates(id) on delete set null;

create or replace function public.touch_role_templates_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists role_templates_touch_updated_at on public.role_templates;
create trigger role_templates_touch_updated_at
  before update on public.role_templates
  for each row execute function public.touch_role_templates_updated_at();

alter table public.role_templates enable row level security;

drop policy if exists "role_templates_read_org_member" on public.role_templates;
create policy "role_templates_read_org_member"
  on public.role_templates for select
  using (
    organization_id is null
    or exists (
      select 1 from public.org_users ou
       where ou.organization_id = role_templates.organization_id
         and ou.user_id = auth.uid()
    )
    or exists (
      select 1
        from public.location_users lu
        join public.locations l on l.id = lu.location_id
       where lu.user_id = auth.uid()
         and l.organization_id = role_templates.organization_id
    )
  );

drop policy if exists "role_templates_write_owner_admin" on public.role_templates;
create policy "role_templates_write_owner_admin"
  on public.role_templates for all
  using (
    organization_id is not null
    and is_system = false
    and exists (
      select 1 from public.org_users ou
       where ou.organization_id = role_templates.organization_id
         and ou.user_id = auth.uid()
         and ou.role in ('owner','admin')
    )
  )
  with check (
    organization_id is not null
    and is_system = false
    and exists (
      select 1 from public.org_users ou
       where ou.organization_id = role_templates.organization_id
         and ou.user_id = auth.uid()
         and ou.role in ('owner','admin')
    )
  );

------------------------------------------------------------
-- 4. Seed system templates (organization_id = null, is_system = true)
--    Idempotent — uses on-conflict do nothing on (org_id, key) unique.
------------------------------------------------------------

insert into public.role_templates (organization_id, key, label, description, permissions, is_system, sort_order)
values
  (null, 'manager', 'Manager', 'Leads the location: full operational + financial + config access except staff management.',
   jsonb_build_object(
     'bookings', true, 'customers', true, 'reminders', true, 'fleet', true,
     'products', true, 'notifications', true,
     'revenue', true, 'invoices', true, 'reports', true,
     'quotes_draft', true, 'quotes_send', true, 'quotes_approve_view', true,
     'services', true, 'bays', true, 'automations', true, 'campaigns', true,
     'org_settings', false, 'staff_manage', false,
     'audit_log', true, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', true
   ), true, 10),
  (null, 'service_advisor', 'Service Advisor', 'Bookings + quotes + customer-facing comms. Sees prices, not margins.',
   jsonb_build_object(
     'bookings', true, 'customers', true, 'reminders', true, 'fleet', true,
     'products', true, 'notifications', true,
     'revenue', false, 'invoices', true, 'reports', true,
     'quotes_draft', true, 'quotes_send', true, 'quotes_approve_view', true,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', false, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', true
   ), true, 20),
  (null, 'mechanic', 'Mechanic', 'Wrenches: jobs, drafts DVI quotes from notes. Cannot send quotes or see invoices.',
   jsonb_build_object(
     'bookings', true, 'customers', true, 'reminders', false, 'fleet', true,
     'products', true, 'notifications', true,
     'revenue', false, 'invoices', false, 'reports', false,
     'quotes_draft', true, 'quotes_send', false, 'quotes_approve_view', true,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', false, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', true
   ), true, 30),
  (null, 'apprentice', 'Apprentice', 'Supervised tech. Read-only customer data, can log work but no quoting/pricing.',
   jsonb_build_object(
     'bookings', true, 'customers', true, 'reminders', false, 'fleet', false,
     'products', true, 'notifications', true,
     'revenue', false, 'invoices', false, 'reports', false,
     'quotes_draft', false, 'quotes_send', false, 'quotes_approve_view', false,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', false, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', true
   ), true, 40),
  (null, 'receptionist', 'Receptionist', 'Front-of-house: bookings, customers, reminders. Reads invoices, no quoting.',
   jsonb_build_object(
     'bookings', true, 'customers', true, 'reminders', true, 'fleet', true,
     'products', false, 'notifications', true,
     'revenue', false, 'invoices', true, 'reports', false,
     'quotes_draft', false, 'quotes_send', false, 'quotes_approve_view', true,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', false, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', true
   ), true, 50),
  (null, 'parts', 'Parts / Stores', 'Stock and supplier-cost view. Sees parts margin, nothing customer-facing.',
   jsonb_build_object(
     'bookings', false, 'customers', false, 'reminders', false, 'fleet', false,
     'products', true, 'notifications', true,
     'revenue', true, 'invoices', false, 'reports', true,
     'quotes_draft', false, 'quotes_send', false, 'quotes_approve_view', false,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', false, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', false
   ), true, 60),
  (null, 'bookkeeper', 'Bookkeeper', 'Financial-only: invoices, Stripe, Xero, revenue, audit. No customer ops.',
   jsonb_build_object(
     'bookings', false, 'customers', false, 'reminders', false, 'fleet', false,
     'products', false, 'notifications', true,
     'revenue', true, 'invoices', true, 'reports', true,
     'quotes_draft', false, 'quotes_send', false, 'quotes_approve_view', true,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', true, 'gdpr_actions', false,
     'stripe_connect', true, 'xero_integration', true,
     'mot_records', false
   ), true, 70),
  (null, 'staff', 'Staff (legacy)', 'Backwards-compatibility template matching the old "staff" preset.',
   jsonb_build_object(
     'bookings', true, 'customers', true, 'reminders', true, 'fleet', true,
     'products', true, 'notifications', true,
     'revenue', false, 'invoices', false, 'reports', false,
     'quotes_draft', false, 'quotes_send', false, 'quotes_approve_view', false,
     'services', false, 'bays', false, 'automations', false, 'campaigns', false,
     'org_settings', false, 'staff_manage', false,
     'audit_log', false, 'gdpr_actions', false,
     'stripe_connect', false, 'xero_integration', false,
     'mot_records', true
   ), true, 80)
on conflict (organization_id, key) do update
  set label = excluded.label,
      description = excluded.description,
      permissions = excluded.permissions,
      sort_order = excluded.sort_order,
      updated_at = now();

------------------------------------------------------------
-- 5. Backfill permissions for existing rows that have empty JSON.
------------------------------------------------------------

update public.location_users
   set permissions = jsonb_build_object(
     'bookings', true,
     'customers', true,
     'reminders', true,
     'fleet', true,
     'products', true,
     'notifications', true,
     'revenue', case when role = 'manager' then true else false end,
     'invoices', case when role = 'manager' then true else false end,
     'reports', case when role = 'manager' then true else false end,
     'quotes_draft', case when role = 'manager' then true else false end,
     'quotes_send', case when role = 'manager' then true else false end,
     'quotes_approve_view', case when role = 'manager' then true else false end,
     'services', case when role = 'manager' then true else false end,
     'bays', case when role = 'manager' then true else false end,
     'automations', case when role = 'manager' then true else false end,
     'campaigns', case when role = 'manager' then true else false end,
     'org_settings', false,
     'staff_manage', false,
     'audit_log', case when role = 'manager' then true else false end,
     'gdpr_actions', false,
     'stripe_connect', false,
     'xero_integration', false,
     'mot_records', true
   )
 where permissions = '{}'::jsonb or permissions is null;
