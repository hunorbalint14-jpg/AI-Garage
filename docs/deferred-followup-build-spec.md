# Deferred work bank + automated follow-up — build spec (#498)

Recover declined and deferred work automatically. AutoLeap's research pegs
automated 14/30-day text sequences at 18–28% recovery of deferred repairs
within 45 days; Garage Hive and TechMan sell VHC follow-up as a core loop.
Today our declined quote lines and amber eVHC advisories just evaporate.

**Architecture in one line: a `deferred_work` table is the bank (one row per
outstanding repair, with follow-up state); creation is hooked into the
existing quote-decline and report-send paths; the sequence rides the existing
`scheduled_tasks` fan-out; recovery is attributed through the booking widget.**

Everything reuses rails that already exist: unified quotes (#253), the eVHC
outcome fields (#497), reminders cron + `scheduled_tasks` tick fan-out, AI
drafting with the org brief, branch-identity comms (#367), and the booking
widget's prefill path (`/book?quote=…` precedent).

## Data model (PR 2)

```sql
deferred_work (
  id, location_id, organization_id,          -- set_org_from_location trigger
  customer_id references customers on delete cascade,
  vehicle_id  references vehicles  on delete cascade,
  source text check (source in ('quote_item', 'inspection_item')),
  quote_item_id      uuid null references quote_items      on delete set null,
  inspection_item_id uuid null references inspection_items on delete set null,
  description text not null,                 -- SNAPSHOT (survives source deletion)
  price numeric(10,2),                       -- snapshot, null = never priced
  rag text check (rag in ('amber','red')),   -- null for plain quote lines
  status text check (status in ('open','recovered','dismissed')) default 'open',
  followup_count int not null default 0,
  last_followup_at timestamptz,
  book_token_hash text,                      -- sha256; set when a follow-up goes out
  recovered_booking_id uuid null references bookings on delete set null,
  recovered_at timestamptz,
  dismissed_reason text,
  created_at, updated_at
)
-- Partial unique-ish guard in code, not DDL: one OPEN row per
-- (vehicle_id, lower(description)) — a re-declined repair refreshes
-- price/created_at on the existing row instead of stacking.
```

RLS: operational, `private.is_location_member(location_id)`, the usual
schema-qualified helpers, `to authenticated`. Cron and hooks write via the
admin client.

### Creation hooks (all server-side, admin client)
1. **Quote declined** (`declineQuote`, portal owner decline, standalone
   decline): every line → record.
2. **Quote partially approved** (`approveQuote` with a subset): the
   unapproved lines → records.
3. **Report sent with unquoted advisories** (`sendInspectionReport`): amber/
   red findings with `outcome='none'` → records (the "never quoted" bank).
   eVHC declines need no extra hook — findings-quote lines are `quote_items`,
   so hook 1/2 covers them; `inspection_item_id` on the line carries rag +
   photo linkage into the record.
4. **Backfill migration**: existing declined quotes' lines + eVHC
   `inspection_items` with outcome `declined`/`none` (sent/complete checks).

The eVHC `DeferredWorkPanel` (#522) switches to reading this table — one bank,
both sources. `src/lib/deferred-work.ts` keeps its shape but queries
`deferred_work`.

## Follow-up sequence (PR 3)

- **Dispatch**: new `scheduled_tasks` `task_type='deferred_followups'` →
  `/api/cron/deferred-followups` via the tick fan-out (per-location, hourly
  tick honours the task's configured send hour — that's the quiet-hours
  control, same as reminders).
- **Stages**: offsets stored on `organizations.deferred_followup_days int[]`
  (default `{14,30}`). Stage N fires when `followup_count = N-1` and
  `created_at <= now() - offset[N]` — each record gets each stage at most
  once; the watermark is `followup_count` + `last_followup_at`, mirroring the
  quote-reminder day logic.
- **Grouping**: ONE message per (customer, vehicle) covering all due open
  records — never a message per line.
- **Frequency caps**: skip the customer entirely if (a) any deferred
  follow-up reached them in the last 7 days, or (b) a reminder (MOT/service/
  tax) was sent to them in the last 7 days (`reminders` table) — a customer
  never gets two nags in a week. Email suppression list honoured by
  `sendEmail` as everywhere.
- **Consent stance**: same as MOT/service reminders — service communication
  about the customer's own vehicle (legitimate interest), not marketing.
- **Message**: AI-drafted per message (Haiku, org AI brief injected, usage
  feature `deferred_followup_draft`) naming the actual findings and prices —
  not a generic "you have outstanding work" blast. Plain template fallback;
  AI failure never blocks the send. Email embeds the finding's photo (signed
  URL, 7-day TTL) when the record links to an inspection item with media.
  Email + SMS; branch identity block/inline (the record's `location_id` — the
  servicing branch, per the event-level comms rule).
- **Book-it link**: `/book?dw=<token>` — one token minted per message,
  sha256 stored on every record it covered (`book_token_hash`). The widget
  resolves it (vehicle + customer prefill) and carries it to booking
  creation, which marks the covered records `recovered` +
  `recovered_booking_id`. Token invalid/expired → widget behaves as plain.

## Staff surfaces (PR 4)

- **`/staff/deferred`** — the pipeline: open records grouped by vehicle
  (reg, customer, items, £, age, follow-ups sent), filters open/recovered/
  dismissed, row actions **Dismiss** (with reason) and **Mark recovered**
  (link to a booking optional). Nav under Ops; beta chip.
- **Customer page / job card panels** (#522) now read the bank and gain the
  same row actions.
- **Dashboard widget** (owner/manager roles): "£X in open deferred work ·
  £Y recovered this month" + link to `/staff/deferred`. Computed live from
  `deferred_work` (sum price where open; sum where recovered_at in month).
- **Settings**: the automations/scheduled-tasks surface gains the
  `deferred_followups` task (enable + hour), and org settings expose the
  offsets field.

## Gating & rollout

- Bank + staff surfaces ship dark-launched (no flag — internal only, no
  sends). The **cron sequence** is gated behind a global `deferred_followups`
  feature flag; flip per staged rollout.

## Explicit MVP cuts

- WhatsApp channel (email + SMS first; WhatsApp is a checkbox later).
- Auto-recovery inference (matching later job lines back to records) — manual
  mark + link attribution only.
- Per-record snooze / custom cadence per customer.
- Campaign-style analytics beyond the two dashboard numbers.

## Risks / repo gotchas that WILL bite

- supabase-js lazy builders: every fire-and-forget write chains `.then()`
  (#523 precedent).
- `quotes` ↔ `inspections` double FK: hint any embed that walks both.
- Migration version: check latest on disk before numbering.
- Cron route must be added to the tick `TASK_ROUTE` map AND `scheduled_tasks`
  rows seeded per location (backfill for existing orgs + signup hook), or the
  sequence silently never fires.
- Booking widget is public + CSP-constrained; the `dw` token must survive the
  full stepper (hidden field through steps, like the quote prefill).

## Acceptance (from #498, restated)

1. Declining a quote line (any path) creates a deferred-work record
   automatically; partial approval banks the unapproved lines. (PR 2)
2. The sequence fires at the configured offsets, once per stage, respecting
   the 7-day frequency cap; booking via the link marks the records recovered.
   (PR 3)
3. Dashboard shows open deferred £ and recovered £ this month. (PR 4)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | Schema + RLS + creation hooks + backfill + panel switch | M |
| 3 | Cron sequence + AI drafting + comms + book-link attribution | L (the big one) |
| 4 | /staff/deferred + row actions + dashboard widget + settings | M |
