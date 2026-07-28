-- MTD readiness (docs/mtd-readiness.md). Garage-AI's position is "digital
-- link source" — sales records flow losslessly into the org's
-- HMRC-recognised accounting package. This migration carries the schema
-- for the readiness workstreams:
--   1. Per-line VAT treatment snapshot (tax fidelity of the sync)
--   2. Accounting link health (reconnect detection)
--   3. MOT disbursement guardrail (VTAXPER48000)
--   4. Business structure capture (MTD for Income Tax segmentation)

-- ── 1. job_items.vat_treatment ────────────────────────────────────────────
-- The numeric vat_rate snapshot (#451) renders the invoice, but 0% is
-- ambiguous: zero-rated and exempt sales belong in Box 6 of the VAT
-- return, outside-scope (MOT fee) ones do not. Store the treatment per
-- line so the accounting sync can push distinct provider tax codes.
alter table public.job_items
  add column if not exists vat_treatment text
    check (vat_treatment in ('standard', 'zero', 'exempt', 'outside_scope'));

-- Backfill what is knowable: a positive rate is standard; a 0% line with a
-- linked catalogue service takes the service's current treatment. Orphan
-- 0% lines stay NULL — the sync's fallback (outside_scope) preserves the
-- historic provider behaviour instead of guessing a Box 6 change.
update public.job_items
   set vat_treatment = 'standard'
 where vat_treatment is null
   and vat_rate > 0;

update public.job_items ji
   set vat_treatment = s.vat_treatment
  from public.services s
 where ji.vat_treatment is null
   and ji.service_id = s.id
   and ji.vat_rate = 0;

-- ── 2. Accounting link health ─────────────────────────────────────────────
-- A failed token refresh used to silently sever the digital link (Sage
-- refresh tokens die after 31 days unused, QuickBooks after ~100). Record
-- the failure so the UI can show a "reconnect needed" banner and the
-- health panel can distinguish "dead link" from "nothing to sync".
alter table public.accounting_connections
  add column if not exists needs_reconnect boolean not null default false,
  add column if not exists last_refresh_error text,
  add column if not exists last_refresh_error_at timestamptz;

-- ── 3. MOT disbursement guardrail (VTAXPER48000) ──────────────────────────
-- An approved test centre's MOT fee (≤ statutory max) is outside the scope
-- of VAT. A garage that SUBCONTRACTS the MOT may only treat the exact
-- amount the test centre charged as outside scope — any markup is
-- standard-rated and must be a separate line. Per-branch flag because VTS
-- approval is per site.
alter table public.locations
  add column if not exists mot_subcontracted boolean not null default false;

-- ── 4. Business structure (MTD for Income Tax) ────────────────────────────
-- Sole traders over the qualifying-income threshold are mandated into MTD
-- for Income Tax from April 2026; limited companies are not. Captured so
-- the product can target education/deadline surfaces at the right orgs.
alter table public.organizations
  add column if not exists business_structure text
    check (business_structure in ('sole_trader', 'partnership', 'limited_company'));
