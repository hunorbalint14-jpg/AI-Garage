# Making Tax Digital (MTD) readiness

Research findings, verified against gov.uk / HMRC Developer Hub on 2026-07-28
(38 load-bearing regulatory claims fact-checked against primary sources: 35
confirmed, corrections noted inline). Codebase audit of the VAT model and the
accounting sync as of this date.

## Decision

**Do not become HMRC-recognised filing software. Make Garage-AI a complete,
lossless, provably-healthy *digital link* into the HMRC-recognised software the
garage already files from (Xero / QuickBooks / Sage — or their accountant's
package via a CSV designed for import).**

The legal basis: VAT Notice 700/22 §3.2 explicitly allows "functional
compatible software" to be **a set of programs** connected by *digital links*.
API transfer and CSV import/export are named digital links; manual re-keying
and copy-paste are named non-links. Because Garage-AI generates the garage's
sales invoices, it already *is* part of each customer's functional compatible
software — it holds the primary digital record of supplies made (which must
capture, per supply: **time of supply, net value, VAT rate**). The accounting
package files the return; our job is that the hand-off is digital, complete,
and correct.

Why not file directly: the 9-box VAT return needs the purchases side (boxes
4/7), and Garage-AI deliberately holds no purchase ledger. Every competitor
that files directly (Garage Hive via Dynamics 365 Business Central, Motasoft,
GarageData, Powered Now, GarageBooks) owns a sales **and purchase** ledger.
The integrate camp (TechMan, Commusoft, simPRO, ServiceM8, Tradify) does
exactly what we do: one-way push into the accounting package, no MTD claims of
their own. Direct filing also drags in the HMRC vendor burden — 16 legally
mandatory fraud-prevention headers per call (`Gov-Client-Device-ID`,
originating public IP + TCP source port, screen/window/timezone captured by
client JS — genuinely awkward behind Vercel's proxy), sandbox evidence +
SDSTeam approval, per-taxpayer OAuth with 18-month re-consent, 72-hour breach
notification, revocable credentials. Parked unless it becomes a competitive
necessity (see "Direct filing, if ever" below).

## The regulatory position (verified 2026-07-28)

**MTD for VAT** — settled law. All VAT-registered businesses regardless of
turnover since April 2022 (VAT Notice 700/22, force of law). Digital records
per supply made: tax point, net value ex-VAT, VAT rate. Once data enters any
program in the chain, every onward move into the return figures must be a
digital link — no re-keying, no copy-paste; soft-landing ended April 2021.

**MTD for Income Tax** — live now, and the reason this research matters
today. Sole traders with qualifying income (gross turnover, prior-year SA
return) over £50,000 are mandated since **6 April 2026**; their **first
cumulative quarterly update is due 7 August 2026**. Waves: >£30k from April
2027, >£20k from April 2028 (~2.9m taxpayers in total; HMRC says 864k+ in the
first wave). Virtually any full-time sole-trader garage clears £50k turnover.
Limited-company garages are untouched (no MTD for Corporation Tax; their
exposure stays MTD VAT). Mandated taxpayers cannot use HMRC's free online
filing — they must use commercial software or their accountant (75% of the
first wave are agent-represented). Quarterly updates are **cumulative
category totals** — HMRC never receives individual invoices; our data feeds
the totals via the accounting package.

**Penalties** (context for why sync gaps now hurt quarterly, not annually):
late-submission points, £200 at threshold. Late payment: 3% at day 15 + 3% at
day 30 + 10%/yr from day 31 — rising to **4%/4%/10% from April 2027** (build
messaging around the end-state). 2026-27 MTD IT easement: no quarterly-update
late-submission penalties, one-off 30-day late-payment grace.

**Garage-specific VAT rules** (primary sources: VTAXPER48000, margin-scheme
guidance, Notice 706):

- **MOT**: an approved test centre's fee (≤ statutory max) is outside scope.
  A garage *subcontracting* the MOT may treat only the **exact amount the
  test centre charged** as outside scope (disbursement), and only if the
  VTAXPER39000 conditions hold — **any markup is standard-rated**, and if the
  amounts aren't split, VAT is due on the whole fee. Our name-heuristic
  auto-flag (`services.vat_treatment = outside_scope`) is right for approved
  centres but does not enforce the markup split for subcontracted MOTs — the
  known #514 edge, now with the exact rule to build against.
- **Used-car margin scheme**: needs a per-vehicle stock book, VAT at 1/6 of
  margin. Not modelled — declare vehicle *sales* out of product scope in docs.
- **Partial exemption**: finance-introduction commission (Bumper referrals)
  is VAT-exempt income; the garage's accountant needs it distinguishable for
  the Notice 706 calculation. Worth a tag on synced/exported data, not logic.

## Gap analysis — what the audit found

The invoice→payment core sync (job invoices, Stripe checkout payments,
mark-paid, Bumper settlements) is a genuine digital link with solid
idempotency and a books-health panel. Around it, three problem classes:

### 1. Tax fidelity — the sync misstates VAT in the package that files

These are correctness bugs today, independent of any MTD positioning:

- `SalesLine.standardRated` is a **binary** (`sync.ts` `buildSalesLines`):
  zero-rated, exempt, and outside-scope all collapse to one provider "no VAT"
  code (Xero `NONE`, QBO `No VAT`→`Exempt` fallback, Sage
  `GB_NO_TAX`→`GB_ZERO`). Zero-rated/exempt sales belong in Box 6;
  outside-scope doesn't. The garage's VAT return is subtly wrong unless the
  accountant recodes every line.
- **Credit notes push hardcoded standard-rated** on all three providers
  (`xero-provider.ts:307`, `quickbooks-provider.ts:413`,
  `sage-provider.ts:374`) — a refund against a 0%-VAT invoice gains 20% VAT
  provider-side.
- **Consolidated account invoices**, if pushed via retry, hit the fallback
  single-line branch marked fully standard-rated — wrong VAT and total for
  mixed-VAT consolidations.
- **`vat_treatment` is not persisted on lines** — `job_items` snapshot only a
  numeric rate (0 or 20), so stored data cannot distinguish zero/exempt/
  outside-scope, and the treatment source (`services.vat_treatment`) is
  retroactively editable. Booking and consolidated invoices have no per-line
  VAT rows at all. Refund VAT splits pro-rata at the invoice's blended rate
  (no per-line refunds).

### 2. Coverage — money that never syncs (each one = re-keying = broken link)

- Service-plan **subscription revenue**: `invoice.paid` webhook only accrues
  `plan_subscriptions.paid_in_pence`; no invoice row, no accounting record.
- **Quote deposits** (job + standalone): real money with a VAT tax point at
  receipt; stamped `deposit_paid_at` and nothing else — no invoice, no entry.
- **Account payments** (bank/cheque/cash + Stripe balance payments): allocate
  across invoices but never push; partial payments structurally unsupported
  (one `accounting_payment_id` per invoice; retry pushes the full total).
- **Stripe-dashboard refunds** (`charge.refunded`): credit note row written,
  never pushed. **`payment_intent.succeeded`** payments: marked paid, not
  pushed (only `checkout.session.completed` pushes).
- **Stripe fees**: payouts post net; all three providers document "fees
  remain an imbalance the accountant resolves" — a recurring manual journal.
- **`deleteInvoice`** removes a *sent* invoice locally without voiding the
  authorised provider invoice — orphaned live sales invoice, and the job can
  be re-invoiced under a new number. No VAT-period locking anywhere.

### 3. Link reliability — the digital link can die silently

- **Token death is silent**: a failed refresh makes `getAccountingConnection`
  return null and every push skips with no sync-log row, no banner, no alert.
  Sage refresh tokens die after 31 days unused, QBO after ~100 — a quiet
  month severs the link unnoticed; only symptom is climbing unsynced counts.
- **No automated retry**: recovery is an owner clicking "Retry sync now",
  capped at 20 records per entity type per click.
- **No fallback for unconnected orgs**: the only CSV export is the
  header-level GDPR artifact (UUID foreign keys, no lines, no tax codes) —
  useless for accounting import, so an org not on Xero/QBO/Sage re-keys
  everything, which is precisely the non-compliant pattern.

## Proposed workstreams

Ordered; 1–2 are bug-fix-grade and worth doing regardless of MTD framing.

1. **Tax-fidelity fixes in the sync.** Persist `vat_treatment` on
   `job_items` (and on synthesised booking/consolidated lines); carry it
   through `SalesLine` as an enum, not a boolean; map per provider (Xero
   `ZERORATEDOUTPUT` / `EXEMPTOUTPUT` / `NONE`; QBO zero-rated / exempt / No
   VAT; Sage `GB_ZERO` / `GB_EXEMPT` / `GB_NO_TAX`); push credit notes with
   the source invoice's actual VAT mix; fix the consolidated fallback line.
2. **Coverage closure.** Deposits and plan revenue become synced documents
   (or at minimum synced payment entries); push account payments (needs
   multi-payment support per invoice); push refunds from `charge.refunded`
   and payments from `payment_intent.succeeded`; void provider invoice on
   delete — and consider forbidding delete of *sent* invoices outright
   (credit note instead), which also serves the digital-record-keeping story.
3. **Link health.** Reconnect-needed detection (refresh failure → sync-log
   row + persistent Settings banner + email to owner, same pattern as billing
   banners); background retry cron for unsynced/failed records; books-health
   surfaced somewhere the owner actually looks (dashboard tile / digest line).
4. **MTD readiness checklist per org** (derived, like the activation
   checklist): VAT settings complete (+ VAT-number format check), accounting
   sync connected & healthy, unsynced count zero, no re-keying paths in use.
   Doubles as the sales surface for the claim.
5. **Accounting-import CSV export** for unconnected orgs: per-line, contact
   names, dates, per-line tax treatment, import-ready for Xero/QBO/Sage
   (their sales-invoice CSV formats) — a valid digital link at near-zero
   build cost, and the compliant answer for "my accountant uses something
   else".
6. **MOT disbursement guardrail.** For orgs marked as *not* approved test
   centres (subcontracted MOTs): guide/enforce the split — outside-scope line
   at the exact test-centre charge + standard-rated markup line
   (VTAXPER48000). Closes the #514 open edge.
7. **MTD for Income Tax education + segmentation.** Capture business
   structure (sole trader / partnership / ltd) at onboarding; for sole-trader
   orgs surface deadlines (7 Aug / 7 Nov / 7 Feb / 7 May), the 2026-27
   penalty holiday ending, and the "your sales data flows straight into your
   MTD software" story. First-wave deadline is 7 Aug 2026 — timely.

**Marketing rule** (Developer Hub terms of use + accountancy-press scrutiny):
never claim "HMRC-recognised" or "MTD-compliant software" — we are not on the
gov.uk list and the list is publicly searchable. The defensible claim is
**"MTD-compliant workflow through HMRC-recognised accounting software"**
(digital-links language). HMRC does not "approve" software at all.

## Direct filing, if ever (parked)

Only worth revisiting if pilots demand in-app VAT filing. What it takes:
VAT (MTD) API is small (6 endpoint groups, 9-box payload, `read:vat`/
`write:vat`) but requires: a purchases side we don't have (Box 4/7 —
i.e. becoming accounting software or partnering); 16 mandatory
`Gov-Client-*`/`Gov-Vendor-*` fraud-prevention headers per call under
`WEB_APP_VIA_SERVER` (per-browser device UUID, client-JS screen/window/
timezone capture, originating public IP **and TCP source port** — hard behind
Vercel; HMRC fines/blocks persistent offenders); sandbox evidence + Test FPH
API + SDSTeam questionnaire (~10 working days); per-org HMRC OAuth with
18-month re-consent (plumbing pattern exists — mirrors the Xero OAuth +
encrypted tokens); terms-of-use (responsible individual, 72h breach
notification, revocable credentials); a live real-VRN submission before
listing. MTD for Income Tax direct integration (~30 APIs, quarterly updates,
EOY adjustments, final declaration) is a tax-software product in its own
right — out of scope permanently.

## Sources (primary)

- VAT Notice 700/22 — digital records, digital links, functional compatible
  software: gov.uk/government/publications/vat-notice-70022-making-tax-digital-for-vat
- MTD IT eligibility & thresholds: gov.uk/guidance/check-if-youre-eligible-for-making-tax-digital-for-income-tax
- MTD IT quarterly updates (cumulative, deadlines): gov.uk/guidance/use-making-tax-digital-for-income-tax/send-quarterly-updates
- MTD IT penalties (incl. 2026-27 easements, 2027-28 4% rates): gov.uk/guidance/penalties-for-making-tax-digital-for-income-tax
- VAT late-submission points / late-payment penalties: gov.uk/guidance/penalty-points-and-penalties-if-you-submit-your-vat-return-late, gov.uk/guidance/how-late-payment-penalties-work-if-you-pay-vat-late
- MOT disbursements: gov.uk/hmrc-internal-manuals/vat-taxable-person/vtaxper48000
- Margin scheme (vehicles): gov.uk/guidance/using-the-vat-margin-scheme-for-second-hand-vehicles
- Partial exemption: gov.uk/guidance/vat-exemption-and-partial-exemption
- VAT (MTD) API: developer.service.hmrc.gov.uk/api-documentation/docs/api/service/vat-api/1.0
- Fraud prevention headers (WEB_APP_VIA_SERVER): developer.service.hmrc.gov.uk/guides/fraud-prevention/connection-method/web-app-via-server/
- VAT vendor process: developer.service.hmrc.gov.uk/guides/vat-mtd-end-to-end-service-guide/
- ITSA end-to-end guide: developer.service.hmrc.gov.uk/guides/income-tax-mtd-end-to-end-service-guide/
- HMRC software directory (garage search → Garage Data System Ltd only):
  tax.service.gov.uk/making-tax-digital-software
