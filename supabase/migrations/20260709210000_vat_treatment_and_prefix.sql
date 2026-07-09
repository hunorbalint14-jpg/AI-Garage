-- VAT correctness for pilot (#451, option A) + branch invoice prefixes.
--
-- 1. Per-service VAT treatment. UK garages sell mixed-VAT work: parts/labour
--    are standard-rated, but the MOT test fee is OUTSIDE THE SCOPE of VAT
--    (statutory-capped, never VATable). One hardcoded 20% rate cannot render
--    a lawful invoice for a job that includes an MOT.
-- 2. Per-line VAT snapshot on job_items — the rate is captured when the line
--    is written so a later catalogue edit can't rewrite an issued invoice.
-- 3. Org VAT registration. Garages under the registration threshold must not
--    charge VAT at all, and VAT invoices legally carry the VAT number.
-- 4. locations.invoice_prefix — branch-prefixed document numbers
--    (SMI-INV-0005) so multi-branch orgs' paperwork is unambiguous.

alter table public.services
  add column if not exists vat_treatment text not null default 'standard'
    check (vat_treatment in ('standard', 'zero', 'exempt', 'outside_scope'));

alter table public.job_items
  add column if not exists vat_rate numeric not null default 20;

alter table public.organizations
  add column if not exists vat_registered boolean not null default true,
  add column if not exists vat_number text;

alter table public.locations
  add column if not exists invoice_prefix text;

-- Seed branch prefixes from the slug (first three letters, uppercased).
-- Editable later; collisions across branches are cosmetic — numbering
-- uniqueness is enforced per location_id, not per prefix.
update public.locations
   set invoice_prefix = upper(left(regexp_replace(slug, '[^a-zA-Z]', '', 'g'), 3))
 where invoice_prefix is null
   and length(regexp_replace(slug, '[^a-zA-Z]', '', 'g')) >= 2;

-- MOT services already in catalogues are the reason this exists — flag the
-- obvious ones. (Name-based heuristic; owners can correct in Settings.)
update public.services
   set vat_treatment = 'outside_scope'
 where vat_treatment = 'standard'
   and name ~* '\mMOT\M';
