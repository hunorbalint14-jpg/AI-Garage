# Self-serve activation — build spec (#506)

New orgs land on an empty dashboard with no path from "signed up" to "first
paid invoice". Incumbents close that gap with paid, human onboarding (TechMan
training programmes, GDS paid setup); our answer is self-serve activation:
a checklist that derives itself from real state, a sandbox to play in, and a
short email sequence that stops the moment the garage is actually trading.

Everything reuses what exists — the owner onboarding survey (AI brief), the
platform email shell, the support assistant, feature flags. No new services.

## Shape

### PR 1 — this spec

### PR 2 — setup checklist + "ask AI" affordance (M)

Dismissible card at the top of the staff dashboard, owner/admin only, with a
progress ring. **Every step's state is derived from real data — nothing is
manually ticked, so it self-completes and can never lie.**

| Step | Done when | Deep link |
|---|---|---|
| Opening hours | `locations.business_hours` set on the active branch | settings |
| Services & prices | ≥1 active service at the branch | /staff/services |
| Workshop bays | ≥1 bay at the branch | settings |
| Invite your team | org has >1 member | /staff/team |
| Get paid online | `stripe_account_id` + `stripe_charges_enabled` | settings |
| Add your logo | `organizations.logo_url` | settings |
| Booking page live | hours + ≥1 active service (implies the widget works) — step shows the public /book URL with copy button | — |
| First customer | ≥1 **non-demo** customer | /staff/customers/new |
| Accounting (optional) | `xero_connected_at` — never blocks 100% | settings |

- One `Promise.all` of cheap `count`/column reads in the dashboard RSC; only
  runs while the card is visible (not dismissed, not complete).
- Dismissal: `organizations.setup_checklist_dismissed_at` (org-level — the
  checklist is about the org, not the viewer). 100% completion hides it
  without dismissal. Optional steps excluded from the ring's denominator.
- **Ask AI**: each step gets a small "ask AI" affordance that deep-links
  `/staff?assist=<url-encoded question>` — the support launcher already reads
  `?ticket=` the same way; extend it to open the panel in chat view with the
  question pre-filled (user presses send; never auto-send). Incumbents charge
  a human for this; ours is instant.

### PR 3 — demo sandbox (M)

One-click "Explore with sample data" for a fresh org; one-click wipe.

- **Migration**: `is_demo boolean not null default false` on `customers`,
  `vehicles`, `bookings`, `jobs`, `invoices`, `quotes`. No RLS change (rows
  are ordinary org rows; the flag only drives badges, wipe, and exclusions).
- **Seeder** (`src/lib/demo-sandbox.ts`, server-side — `scripts/seed-demo.ts`
  is local-only by design and stays that way): a small curated set on the
  active branch — ~6 customers with `@demo.invalid` emails (undeliverable by
  construction), vehicles, a week of bookings, jobs at each stage, one sent
  invoice, one pending quote. All rows `is_demo`. Idempotent: seeding twice
  wipes first.
- **Wipe**: delete in dependency order by `is_demo` + org. Nothing else is
  touched — real rows can't be caught because the flag is the filter.
- **Badges**: amber "demo" chip on the rows in the four main surfaces
  (customers list, jobs board, schedule, invoices list).
- **Banner**: while demo rows exist, a persistent strip on the staff shell —
  "Sample data is loaded — wipe it when you're done exploring" + wipe button.
- **Exclusions**: demo rows never trigger comms (guard in reminders/dunning/
  review-request crons: skip `is_demo` customers/invoices — belt and braces
  on top of the invalid email domain), never count toward activation (PR 4),
  and never sync to Xero (`is_demo` invoices skipped).

### PR 4 — first-week activation emails (S)

Three touches off `renderPlatformEmail`, to the org owner, stopping the
moment the org activates.

- Day 1: "Your booking page is live" — the public link, where to put it
  (Facebook page, Google Business Profile), one CTA.
- Day 3: "Get your customers in" — add/import customers, first invoice how-to.
- Day 7: checklist nudge — whatever steps remain, deep-linked.
- **Stop rule**: org has ≥1 real (non-demo) booking **or** invoice → sequence
  ends. Checklist 100% also ends it (nothing left to say).
- Mechanism: `organizations.activation_stage int not null default 0` (0 = none
  sent, 3 = done). The hourly `/api/cron/tick` calls a new
  `/api/cron/activation` route once per UTC day (platform-level, not
  per-location): orgs `created_at` ≥ N days ago, `activation_stage < N`'s
  touch, not activated → send + bump stage. Idempotent by stage; a missed day
  degrades to "sent late", never "sent twice".
- Feature flag `activation_emails` (global) so the sequence can be halted
  platform-wide without a deploy.

## Explicit MVP cuts

- No A/B testing, no open-tracking, no per-org sequence customisation.
- Demo data excluded from *comms and activation*, not from every report — an
  owner exploring wants to see the dashboard move. The wipe is the reset.
- No in-app product tour (the checklist + assist widget carry that weight).
- Checklist covers setup, not ongoing health (that's the dashboard's job).

## Risks / repo gotchas

- Migration version: pick after checking latest on disk (currently
  `20260711090000`); parallel PRs collide silently.
- `is_demo` on `jobs`→`invoices` embeds: any new embed must hint
  `invoices!invoices_job_id_fkey` (double-FK since `invoice_jobs`).
- Launcher deep-link: mirror the `?ticket=` pattern exactly (clean the param
  from the URL after consuming it) — and never auto-send the primed question.
- Demo seeding must set `location_id` = active branch and let
  `private.set_org_from_location` backfill org where applicable.
- Dashboard checklist reads must not slow the dashboard for established orgs:
  short-circuit on `setup_checklist_dismissed_at` before any counting.

## Acceptance (from #506, restated)

1. New org sees the checklist; each step deep-links and auto-completes from
   real state; completion (or dismissal) hides it. (PR 2)
2. Demo data seeds + wipes cleanly, never mixes with real rows (badge +
   filter), never emails anyone, never counts as activation. (PR 3)
3. Activation sequence sends days 1/3/7 and stops on first real booking or
   invoice. (PR 4)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | Setup checklist + ask-AI deep link | M |
| 3 | Demo sandbox: flag, seeder, wipe, badges, banner, exclusions | M |
| 4 | Activation email sequence | S |
