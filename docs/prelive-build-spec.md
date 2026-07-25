# Prelive mode — build spec

A new garage needs to load their real customers, learn the system and get their
settings right *before* anything reaches those customers. Today they can't: the
moment a branch exists, its automated comms are live.

## The problem, concretely

`scheduled_tasks` rows are only created when someone opens `/staff/automations`
(`ensureDefaultTasks`, called from that page). Every cron treats a **missing**
row as enabled — `src/app/api/cron/reminders/route.ts` returns
`{ enabled: true }` when there's no row; dunning does `if (task &&
task.enabled === false) continue`. So a branch whose owner has never visited
that page is fully armed, silently.

The import wizard bulk-writes `vehicles.mot_expiry`, `service_due` and
`tax_due_date` (`src/app/staff/customers/import/wizard-actions.ts`) — the exact
columns the 09:00 reminders cron scans. Import 2,000 vehicles at 16:00 on setup
day and the next morning every customer with an MOT due inside 30 days gets an
AI-drafted **email + SMS + WhatsApp** from a garage that is still configuring
its hours, templates and branding, about a system switch the customer knows
nothing about. The 30-day dedup means there is no second chance to get it right.

That is a reputational failure on a garage's first week, on data they trusted us
with, and it costs real Twilio spend to inflict.

### What is already safe (don't rebuild)

- Imported invoices land in `imported_invoices`, not `invoices` — dunning
  reads `invoices`, so historic debt is never chased.
- Imported service history isn't `jobs`, so review-requests don't fire for it.
- Sandbox rows (`is_demo`) are already excluded from reminders and dunning (#506).

The exposure is therefore narrow but sharp: **the reminder family** (MOT /
service / tax) and **booking confirmations**, plus anything else keyed off
imported rows.

## The load-bearing decisions

### The flag lives on `locations`, not `organizations`
"Site" is the branch. A three-branch org opening a fourth needs exactly the same
protection for that branch only, and every cron already loops locations, so the
gate lands where the loop already is.

### `locations.live_at timestamptz null` — null means prelive
A timestamp rather than a boolean: "when did this branch go live" is free, and
it is the number activation reporting and support actually want. Going live is
stamping it; there is no un-stamping in the UI (support can, by hand).

**The migration MUST backfill every existing location to `now()`.** Defaulting
the column to null would mute production on deploy. New locations get null.

### Gate at the cron/dispatch layer, never at the send layer
A blanket guard inside `lib/email.ts` / `sms.ts` / `whatsapp.ts` would also kill
password resets, staff invites, support-ticket mail and owner onboarding — all
of which must keep working during setup, because setup *is* what the owner is
doing. Prelive silences **unattended** sends only.

Rule of thumb: **if a human pressed a button, it sends.** If a cron decided, it
holds.

### Hold, don't drop
A silenced reminder is recorded as held, so the Go-live screen can say *"143 MOT
reminders and 12 dunning emails are waiting"*. The owner sees the blast before
it happens — that preview is the actual product here, not the mute switch.

### Readiness reuses the derived setup checklist
`src/lib/setup-checklist.ts` already computes real, non-tickable readiness
(hours, services, bays, team, Stripe, logo) and a `bookingLive` notion. Go-live
hangs off that card. **No second readiness model.**

## Comms inventory — what holds and what doesn't

| Path | Trigger | In prelive |
|---|---|---|
| `/api/cron/reminders` (MOT / service / tax) | cron, per-location task | **HOLD** — the main exposure |
| `/api/cron/dunning` | cron, per-location task | **HOLD** |
| `/api/cron/review-requests` (CSAT pulse) | cron, per-location task | **HOLD** |
| `/api/cron/booking-confirmations` (T-24h) | cron, per-location task | **HOLD** |
| `/api/cron/deferred-followups` | cron + `deferred_followups` flag | **HOLD** |
| `/api/cron/quote-expiry` (quote reminders) | own Vercel schedule, not task-gated | **HOLD** (low volume, gate for consistency) |
| `/api/cron/digest` | cron, weekly, **to owners/admins** | **SENDS** — internal, and it's how the owner learns the data |
| Campaigns / win-back | staff presses send | **SENDS** (with a prelive confirm) |
| Quote / invoice / booking confirmation sent by hand | staff presses send | **SENDS** (with a prelive confirm) |
| Password reset, staff invite, support tickets, owner onboarding + activation emails | platform / auth | **SENDS** — always |

## Shape

### PR 1 — the gate (S) — closes the exposure on its own
- Migration: `locations.live_at timestamptz`, **backfilled to `now()` for every
  existing row**; new rows null.
- `isLocationLive(locationId)` helper + gate in the six holding paths above.
  Gate inside each route (not only in `tick`) so a direct/manual invocation
  can't bypass it.
- Prelive badge in the staff top bar and on the Automations page: "Prelive —
  automatic messages to customers are paused."
- Import wizard: hard warning when the branch is **already live**, and a nudge
  toward prelive when it isn't.
- Acceptance: a fresh branch imports 2,000 vehicles with MOT dates; the 09:00
  reminders run sends **nothing** and says why. An existing (backfilled)
  branch's sends are completely unchanged.

### PR 2 — held log + Go-live screen (M)
- `held_comms` table: location, kind, customer, vehicle/invoice ref, why held,
  `would_have_sent_at`. Written by the same routes that now return early.
- Go-live screen off the setup-checklist card: readiness state + "what will send
  when you go live", grouped by kind with counts and a sample.
- Going live stamps `live_at`, audit-logged, owner-only.
- Acceptance: the counts on the screen match what the next cron run actually
  sends.

### PR 3 — first-run burst policy (M)
The hazard prelive *creates*: flipping live at 16:00 means everything fires at
09:00 the next morning at once, including reminders for MOTs that expired last
week.
- Default on the first run after go-live: send only for due dates **≥ today**;
  overdue ones are listed with an explicit "also chase these 40" opt-in.
- First-day volume cap (setting, sensible default), remainder rolls to the next
  day rather than being dropped.
- Acceptance: a branch going live with 400 due-in-30-days vehicles sends a
  capped first batch, and nothing for already-expired MOTs unless opted in.

## Explicit MVP cuts

- No per-channel prelive (it's all-or-nothing per branch).
- No scheduled go-live ("go live at 09:00 on Monday") — the owner presses it.
- No un-going-live in the UI; support does it by hand if ever needed.
- Prelive does **not** gate payments, the booking widget, or any trading
  function — that would break the billing-lapse invariant that core trading is
  never gated.

## Risks / repo gotchas

- **Backfill or you mute production.** Every existing location must be stamped
  live in the same migration that adds the column.
- **`reminders` is the dedup source.** `DEDUP_DAYS` looks at that table, so held
  rows must NOT be written there with a new status — a held row would suppress
  the real send after go-live. Separate `held_comms` table, or dedup strictly on
  `status = 'sent'`.
- **Gate per route, not only in `tick`.** The child routes are reachable
  directly with the cron secret.
- **`is_demo` is a different axis.** Sandbox = fake data to practise on;
  prelive = real data, silenced. Both can be true; neither implies the other.
- **New-branch default.** `POST` paths that create a location (onboarding, "add
  location") must leave `live_at` null — check both.
- RLS: `held_comms` is customer PII; scope `select` to `private.is_location_member`,
  writes admin-client only.

## Acceptance (epic)

1. A new branch can import real customer data, be explored for days, and send
   **zero** unattended customer messages.
2. Before going live the owner can see exactly what will send, by kind and count.
3. Going live doesn't blast the backlog: overdue reminders need an explicit
   opt-in, and the first day is capped.
4. Every existing branch is unaffected by the rollout.

## Sizing

| PR | Scope | Size | Blocked on |
|---|---|---|---|
| 1 | `live_at` + cron gates + backfill + badge | S | — |
| 2 | Held log + Go-live screen | M | PR 1 |
| 3 | First-run burst policy | M | PR 2 |
