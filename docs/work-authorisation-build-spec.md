# Work authorisation — build spec (#503)

Written authorisation that holds up when a customer disputes a bill. Garage
Hive and TorqueFlow treat digital work approval as core; trading-standards
guidance expects written authorisation against an itemised estimate before
work starts. We have token-link quote approval for the emailed flow, but the
walk-in / at-the-counter flow has no artefact at all — and nothing warns when
work grows past what was authorised.

**Architecture in one line: one `work_authorisations` table holds immutable
artefacts (items + terms + signature/typed-name snapshot); three ways in —
counter signature, quote approval, re-auth link — and one variation check
comparing the job's live total against the newest artefact.**

The differentiator is the variation loop (exceeds-authorised warning → one-tap
re-auth request) — that's where disputes actually happen.

## Data model (PR 2)

```sql
work_authorisations (
  id, location_id, organization_id,          -- set_org_from_location trigger
  job_id     references jobs      on delete cascade,
  quote_id   references quotes    on delete set null,  -- remote path
  customer_id references customers on delete set null,
  kind   text check (kind in ('initial', 'variation')),
  method text check (method in ('counter_signature', 'quote_approval', 'reauth_link')),
  status text check (status in ('pending', 'authorised', 'declined'))
         default 'authorised',                -- 'pending' only for reauth links
  authorised_total numeric(10,2) not null,    -- the amount said yes to
  items_snapshot jsonb not null,              -- itemised estimate AS SHOWN
  terms_snapshot text,                        -- org T&Cs AS SHOWN (full copy)
  signature_path text,                        -- counter: PNG in private bucket
  signed_name text,                           -- remote: typed name
  ip text, user_agent text,
  token_hash text unique, slug text unique,   -- reauth_link gate (sha256 only)
  requested_at timestamptz,                   -- reauth: when the link was sent
  authorised_at timestamptz,
  created_by uuid references auth.users,      -- staff who took/requested it
  created_at, updated_at
)

organizations:
  authorisation_terms text,                   -- current editable T&Cs
  variation_threshold_pct numeric not null default 10
```

- **Immutability by snapshot, not versioning**: every artefact carries a full
  copy of the items and terms as shown at the moment of signing. No
  terms-version table; editing the org terms never rewrites history. UPDATE on
  artefact rows is denied to staff by RLS (insert/select only; lifecycle
  writes go through the admin client).
- **Bucket** `authorisation-signatures`, private, no storage policies —
  signature PNGs are small (<50 KB), uploaded through the server action body,
  read via short-TTL signed URLs. Same recipe as inspection-media minus the
  signed-PUT step.
- RLS: operational (`private.is_location_member`), schema-qualified helpers,
  `to authenticated`.
- **"PDF snapshot" is a print view**, not a generated file: a
  staff-only page renders the stored snapshot (items, terms, signature image,
  timestamp, IP) with print CSS — same call as eVHC's report (PDF export cut,
  print is enough). The artefact row is the legal record; the view just
  displays it.

## Counter signature (PR 2) — acceptance 1

- Job page → "Authorise work" (shown while job is open and unauthorised, or
  when items changed since the last artefact): full-screen sheet listing the
  job's items + total, the org T&Cs (scrollable), then a **canvas signature
  pad** (pointer events — finger/stylus/mouse, works on the workshop tablet;
  clear + retry). Optional signer-name field prefilled with the customer.
- Save: canvas → PNG data URL → server action (decode base64 by hand — the
  CSP `fetch(dataUrl)` trap) → storage + artefact row
  (`kind='initial'` or `'variation'` if one already exists,
  `method='counter_signature'`, items/terms snapshots, staff `created_by`).
- Job card: authorisation state chip — "Authorised £412 · signed 09:14" /
  "Not authorised" / "Exceeds authorised" (PR 4 wires the warning maths).
- Audit `authorisation.captured`.

## Remote artefact on quote approval (PR 3) — acceptance 2

- `/quote/[slug]` approval gains a **typed-name field + "I authorise this
  work" checkbox** (required to submit). `approveQuote` writes a
  `work_authorisations` row: `method='quote_approval'`, quote linkage,
  approved-items snapshot + approved total, org terms snapshot, typed name,
  IP + user-agent from headers.
- The eVHC report (`/check/[slug]`) approves through the same action, so it
  inherits the artefact — pass the typed name through `respondToCheck`.
- Job linkage: DVI quotes carry `job_id`; the artefact lands on the job and
  counts toward its authorised total. Standalone quotes store `job_id null`
  (linked later if converted — nice-to-have, not required).
- No signature canvas remotely — typed name + checkbox + IP is the accepted
  remote standard and what the issue asks for.

## Variation loop (PR 4) — acceptance 3

- **The check**: job's live total (items sum, the invoice-side maths) vs the
  newest `authorised` artefact's `authorised_total`, org threshold
  (`variation_threshold_pct`, default 10%). Pure function, unit-tested.
- Job page + job card show the warning state ("£512 — exceeds authorised
  £412 by 24%").
- **One-tap re-auth request**: staff button → mints a token
  (`status='pending'`, sha256 only, snapshot of the CURRENT items/total/terms)
  → SMS/WhatsApp/email to the customer with branch identity — copy names the
  new total and the delta.
- `/authorise/[slug]?t=…` (token-gated, no login): itemised list with the
  delta highlighted, terms, typed-name + checkbox → artefact flips
  `authorised` (`kind='variation'`, `method='reauth_link'`) with timestamp/IP;
  or Decline (reason) → `declined` + staff notification. Page follows the
  /check gate pattern.
- Audit: `authorisation.reauth_requested` / `authorisation.reauth_responded`.
- Settings: org terms editor + threshold % (owner/admin; lives with the org
  settings surface).

## Explicit MVP cuts

- Generated PDF files (print view of the stored snapshot instead).
- Signature at BOOKING drop-off (bookings often precede any itemised
  estimate; the job is where the estimate exists — revisit with check-in
  flows).
- Countersignature by staff, witness fields, photo-of-customer.
- Blocking edits past the threshold (warn + request re-auth, never block —
  core-trading-never-gated invariant).

## Risks / repo gotchas

- Canvas → data URL: decode base64 manually (CSP `connect-src` blocks
  `fetch(dataUrl)`).
- Server-action body limit: signature PNGs are small; downscale the canvas
  (≤600px wide) before export like the support-widget screenshots.
- Lazy supabase builders: chain `.then()` on any fire-and-forget.
- Migration numbering: check latest on disk.
- `headers()` for IP: honour `x-forwarded-for` first value (Vercel).
- Quote approval is also called by the eVHC report — keep the artefact write
  inside `approveQuote` so both paths get it, and make it best-effort (an
  artefact failure must not block an approval).

## Acceptance (from #503, restated)

1. Walk-in: staff take a signature at the counter; the job stores an
   immutable artefact (items + terms + signature) with a printable view. (PR 2)
2. Remote: quote approval records an authorisation artefact (typed name,
   terms snapshot, IP). (PR 3)
3. A job edited past the authorised amount + threshold shows the warning and
   offers one-tap re-authorisation; both the request and the response are
   audit-logged. (PR 4)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | Schema + bucket + counter signature + job-card state + print view | L |
| 3 | Remote artefact on quote approval (+ eVHC passthrough) | S–M |
| 4 | Variation check + re-auth link + settings | M–L |
