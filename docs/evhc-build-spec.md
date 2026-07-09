# eVHC build spec — digital vehicle health checks (#497)

RAG-graded inspections with photos, AI-written customer findings, and
per-item customer approval. The industry-standard upsell engine (Garage Hive
eVHC, TechMan TechView, Tekmetric DVI — the last reports ~2× estimate-approval
vs verbal-only). Our differentiator: techs write shorthand, Claude rewrites it
into customer-friendly findings.

**Architecture in one line: an inspection is a capture surface; the existing
unified quote is the approval + payment surface.** We do not rebuild per-item
approval, token links, deposits, or decline tracking — `public.quotes` already
has all of it (`approved_item_ids`, `token_hash`/`slug`, deposit columns,
`decline_reason`). The inspection generates a quote; the customer report page
renders RAG + photos and drives the quote's per-item approval.

## Data model (PR 1)

```sql
-- Org-wide checklist catalogue (like service_plans: org-scoped, read via
-- private.is_org_staff, write via private.is_org_admin).
inspection_templates (
  id, organization_id, name, active boolean default true,
  created_at, updated_at
)
inspection_template_items (
  id, template_id, section text,        -- "Brakes", "Tyres", "Underside"…
  label text, sort_order int
)

-- Operational, per-branch (location_id, private.is_location_member) like jobs.
inspections (
  id, location_id, organization_id,     -- set_org_from_location trigger
  job_id references jobs on delete cascade,
  vehicle_id references vehicles on delete set null,
  template_id references inspection_templates on delete set null,
  performed_by references auth.users on delete set null,
  status text check (draft|in_progress|complete|sent) default 'draft',
  quote_id references quotes on delete set null,   -- the generated quote
  token_hash text unique, slug text unique,         -- customer report gate
  sent_at, viewed_at, viewed_count, created_at, updated_at
)
inspection_items (
  id, inspection_id, template_item_id nullable,     -- null = ad-hoc finding
  section text, label text,                         -- SNAPSHOT from template
  rag text check (green|amber|red|not_checked) default 'not_checked',
  note text,                                        -- tech shorthand
  customer_summary text,                            -- AI rewrite (or manual)
  outcome text check (none|quoted|approved|declined) default 'none',
  sort_order int, created_at
)
inspection_media (
  id, inspection_item_id, storage_path text, mime text, size_bytes bigint,
  created_at
)
-- Link quote lines back to findings (feeds outcomes + #498 deferred bank):
alter table quote_items add column inspection_item_id uuid
  references inspection_items(id) on delete set null;
```

- **Bucket** `inspection-media`, private, signed URLs — same recipe as
  `support-shots` / courtesy-car photos (`src/lib/courtesy-photos.ts`).
- **Seed**: one "Standard health check" template (~32 items across Wheels &
  tyres / Brakes / Steering & suspension / Underside / Under bonnet / Lights &
  electrics / Interior & visibility) created for every org — migration backfill
  for existing orgs + hook in `signUpGarage` for new ones.
- Tokens: `sha256(token)` only, mint on send — copy `src/lib/quote-links.ts`.
- RLS gate: new tables ship with policies using the schema-qualified private
  helpers, `to authenticated`, `(select auth.uid())` (CLAUDE.md rule); customer
  report access goes through server routes with the admin client + token check,
  like `/quote/[slug]` — **no anon policies**.

## Tech capture flow (PR 2) — the make-or-break UX

Entry: job card → "Health check" button → `/staff/jobs/[id]/inspection`.
Mobile-first (this is a phone-in-the-workshop surface — ws kit, big touch
targets, same fonts/tokens as the rest of /staff).

- **Default-green sweep**: all items start green-pending; the tech only
  touches exceptions. One bulk "Everything else OK" confirms the rest. This is
  how a 32-point check fits in <5 minutes (the acceptance criterion).
- Per item: R/A/G segmented control → tapping amber/red expands note +
  photo row. `<input type="file" accept="image/*" capture="environment">`,
  browser-resized to ≤1600px before upload (support-widget screenshot
  precedent), uploaded straight to the bucket via signed upload URL — not
  through a server action body.
- Ad-hoc finding: "+ Add finding" appends an item outside the template.
- Autosave per interaction (server action per item write, optimistic UI) —
  a dropped connection in the workshop must not lose a half-done check.
- Complete → status `complete`, summary strip on the job card
  (`3 red · 2 amber · 27 green`).

## AI findings rewrite (PR 3)

- On complete (or per item on demand): shorthand notes → customer-friendly
  `customer_summary` with a severity explanation. `osf lower arm bush split` →
  "Offside front suspension arm bush is split. This affects steering precision
  and tyre wear, and will fail the next MOT. We recommend replacement soon."
- New `src/lib/ai-inspection.ts` following `ai-messages.ts`: **must inject
  `aiBriefSystemBlock`** (org AI brief rule), record `ai_usage_events`, and
  split any client-imported constants into a `-shared.ts` (the `after()`
  transitive-import gotcha).
- Also returns a suggested repair line per red/amber finding matched against
  the org's services/products catalogue (name + price), used by PR 4.
- **Plain path without AI** (acceptance): `customer_summary` falls back to the
  raw note; UI lets staff edit the summary text before sending. AI failure
  never blocks the flow.

## Quote generation (PR 4)

- "Quote the red & amber items" on the completed inspection: creates a
  unified quote (`quote_type='job'`, existing pipeline) with one quote_item
  per selected finding — description = customer_summary, price prefilled from
  the AI suggestion or services/products picker, `inspection_item_id` set,
  VAT per line via the catalogue treatment (#514 model).
- Marks those findings `outcome='quoted'`, stamps `inspections.quote_id`.
- Everything downstream (revisions, reminders, expiry cron, deposit) is the
  existing quote machinery untouched.

## Customer report + per-item approval (PR 5)

- `/check/[slug]` (token-gated route, no login — quote/[slug] pattern):
  branded RAG summary grouped by section; green items listed read-only (the
  trust builder); amber/red findings show photos (signed URLs) +
  customer_summary; priced findings render approve/decline toggles.
- Submitting approvals calls the **existing quote approval action** with the
  mapped quote_item ids — deposits, `approved_after_close`, decline reasons
  all come free. Item outcomes write back: `approved` / `declined`.
- Send: email (renderBrandedEmail shell) + SMS/WhatsApp options; **must use
  `garageLocationBlock` / branch identity** (multi-site rule). Job-card badge
  shows viewed/responded like quotes.

## Outcomes + deferred work (PR 6, bridges to #498)

- Approved findings: quote approval already applies lines to the job
  (`applied_job_item_ids`).
- Declined/never-quoted amber+red findings are the **deferred-work bank**:
  queryable per vehicle via `inspection_items` (outcome + vehicle through
  inspection). Surface: a "Previously advised" panel on the vehicle page and
  at next booking/job creation. #498's automated follow-up campaigns build on
  this — this PR only guarantees the data shape and the panel.
- Audit log entries for send/approve/decline; release-notes entry; nav/beta
  chip (`beta: true`) per the release-notes conventions.

## Gating & rollout

- Global feature flag `evhc` (feature-flags registry) for staged rollout;
  once stable, decide whether it joins the tier matrix (candidate Pro+
  feature — Tekmetric charges for DVI — but keep it all-tiers during early
  access for pilot wow).

## Explicit MVP cuts

- Per-item **video** (quote-level video exists; photos only in MVP).
- Merging `tyre_checks` (keep; later auto-fill the Tyres section from it).
- Marked-up/annotated photos, technician voice capture (voice→job infra
  exists — natural phase 2), PDF export (print CSS on /check is enough).

## Risks / repo gotchas that WILL bite

- `quotes` ↔ `inspections` get two FK paths (`inspections.quote_id`,
  `quote_items.inspection_item_id`) — **hint every PostgREST embed**
  (PGRST201 outage precedent).
- Check the latest migration timestamp on disk before numbering.
- Shell-bypassed mobile capture page? Keep it inside the staff shell —
  the RSC-redirect-into-bypassed-layout blank-page trap.
- Photo previews: don't `fetch(dataUrl)` (CSP connect-src) — decode base64
  by hand as the support widget does.
- Every PR with UI ships screenshots (assets/pr-screenshots flow); mobile
  viewport shots for the capture flow.

## Acceptance (from #497, restated against this design)

1. Tech completes a templated inspection with photos on a phone in <5 min —
   default-green sweep + exception marking (PR 2).
2. Customer approves 2 of 3 amber items from the link; approved land on the
   job via quote-apply; declined stored per vehicle (PRs 4–6).
3. AI rewrite behind the org AI brief; plain-notes path works with AI off
   (PR 3).

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | Schema + RLS + bucket + seed template | S–M |
| 2 | Tech capture flow (mobile) + media upload + templates settings UI | L (the big one) |
| 3 | AI rewrite + suggested lines | M |
| 4 | Quote generation | S |
| 5 | Customer report + approval + comms | L |
| 6 | Outcomes, deferred panel, audit, beta chip, release notes | M |
