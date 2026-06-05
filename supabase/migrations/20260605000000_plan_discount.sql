-- Member discount entitlement (Phase 6 PR3a). A service plan can grant its
-- subscribers a discount on staff-issued invoices — either a percentage or a
-- fixed amount, the garage's choice per plan. The applied amount is stored on
-- the invoice so every render surface (UI / PDF / email / Xero) agrees.

alter table public.service_plans
  add column if not exists discount_type text not null default 'none'
    check (discount_type in ('none', 'percent', 'fixed')),
  add column if not exists discount_value numeric not null default 0;

alter table public.invoices
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists discount_description text;
