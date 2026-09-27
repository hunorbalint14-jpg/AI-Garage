# Wheel & tyre care recommendations — build spec (#596)

Mileage-driven rotation / alignment / balancing prompts. The pitch to the
customer is tyre lifespan; the value to the garage is evidence-backed
recurring revenue between MOTs. The design principle from the issue stands:
**every recommendation must be defensible** — evidence quality gates whether
we contact anyone at all.

**Architecture in one line: persist the mileage + tread evidence we already
see but currently throw away (MOT odometer readings, job odometer, tread
checks), run a pure rules engine over it on the `scheduled_tasks` fan-out,
write `tyre_recommendations` rows with structured evidence, and let staff
approve each send from a review queue — approval triggers the message with
consent, caps, and a booking deep-link that attributes the conversion.**

Everything rides existing rails: the deferred-work bank pattern (#498) for
lifecycle/token attribution, `tyre_checks` for tread data, `lookupMotHistory`
+ the nightly MOT delta cron for odometer series, the automations task UI for
per-garage config, and branch-identity comms (#367).

## Locked decisions (v1)

- **No auto-send.** Every message is staff-approved from the review queue;
  approval sends inline (like win-back). Confidence tier is stored on the row
  so auto-send for high-confidence recs can be revisited with conversion +
  complaint data. Because sends are staff-attended, no prelive `held_comms`
  kind is needed in v1 — that arrives with auto-send.
- **No zone-level tread capture** (inner/centre/outer). Alignment triggers
  run on axle differential, cross-axle differential, MOT advisory text
  matching, and event triggers (suspension/steering work, new tyres without
  alignment). Shoulder differential joins later if garages ask for it.
- **Balancing never messages the customer.** Weakest signal of the three —
  it surfaces as a point-of-service prompt on the job/booking screen only
  (new tyre fitted or wheel refurbished without a recorded balance).
- **Rotation eligibility** comes from a staff-captured `vehicle_wheel_profile`
  (staggered / directional / standard / unknown). Unknown blocks nothing in
  the queue but the approve button demands a profile first — the first
  rotation rec for a vehicle doubles as the capture moment. No external
  fitment API in v1.
- **Odometer capture is prompt-but-allow**, not blocking. A nag on the job
  card beats staff inventing numbers to get past a wall.
- **Routing: home branch.** Recs are customer-level scheduled care comms —
  same rule as MOT/service reminders (`customers.preferred_location_id`),
  branch identity in every message.
- **Compliance: this is marketing**, unlike the existing legitimate-interest
  crons. Per-channel consent (`marketing_email_consent` / `marketing_sms_consent`,
  `anonymized_at is null`) is checked at approval time, every email carries a
  one-click unsubscribe (net-new platform infra, reusable by campaigns and
  win-back), SMS carries an unsubscribe line pointing at the same landing
  page. Inbound SMS STOP webhook is a fast-follow, not v1.
- **Under-3-year-olds** (no MOT history): evaluated from in-house readings
  only, and only once the vehicle has ≥2 dated odometer points. Otherwise it
  counts against the coverage metric, not the recommendation queue.
- **MOT bundling**: no automatic bundling. The queue flags "MOT due in ≤45
  days" on the row so staff time the send; a rec suppressed by staff for
  bundling is `dismissed` with reason `bundle_with_mot`.

## Data model (PR 2 — foundations)

```sql
mot_tests (                          -- persist what lookupMotHistory already returns
  id, vehicle_id references vehicles on delete cascade,
  organization_id,                   -- trigger from vehicle? no — copy at insert
  test_date date not null, result text,
  odometer_miles integer,            -- normalised: KM readings converted
  advisories jsonb not null default '[]',  -- [{text, type}]
  source text check (source in ('lookup','delta')),
  unique (vehicle_id, test_date)
)
alter table jobs add column odometer_miles integer;      -- prompt-but-allow
alter table tyre_checks
  add column organization_id ...,    -- + set_org_from_location trigger
  add column job_id uuid references jobs on delete set null,
  add column odometer_miles integer; -- direct entry when no job context
create index tyre_checks_vehicle_idx on tyre_checks (vehicle_id, checked_at desc);

vehicle_wheel_profile (
  vehicle_id pk references vehicles on delete cascade,
  organization_id,
  tyre_config text check (tyre_config in ('standard','directional','staggered','unknown'))
    default 'unknown',
  rotation_eligible boolean generated / derived in code (standard only),
  notes text, recorded_by, updated_at
)

wheel_service_events (               -- when rotation/alignment/balance actually happened
  id, location_id, organization_id,  -- set_org_from_location
  vehicle_id, service_type text check (in ('rotation','alignment','balance')),
  performed_at date not null, odometer_miles integer,
  job_id uuid null references jobs on delete set null,
  recorded_by, created_at
)
```

MOT ingestion: (a) `extractDeltaUpdate` in `src/lib/dvsa-bulk.ts` stops
discarding `odometerValue`/`defects` — the nightly delta cron upserts
`mot_tests` rows at zero extra DVSA quota; (b) the existing on-demand
`lookupMotHistory` callers write-through the full history the first time a
vehicle is looked at (read-through cache → table, same idempotent upsert).

RLS: `mot_tests` org-scoped read (`private.is_org_staff`); the rest
operational (`private.is_location_member`), all `to authenticated`,
`(select auth.uid())` wrapped, writes via admin client. `tyre_checks` also
gains the org backfill.

## Rules engine (PR 3 — pure lib, vitest like `deferred-followup.test.ts`)

`src/lib/tyre-care.ts`, side-effect-free, `now` injected:

- `estimateMileage(points, now)` — weighted regression over all dated
  odometer points (mot_tests + jobs + tyre_checks + vehicle_history_entries),
  weighted toward the most recent 2–3 (geometric decay); returns
  `{ estimatedNow, avgDailyMiles, confidence, pointCount }`. ≥2 points or
  no estimate. `estimated_mileage_now` renders on the vehicle page.
  **Conflicting readings resolve to the NEWER one** — an older reading that
  exceeds a later one, or whose hop up to it is impossibly fast (>330 mi/day),
  is dropped. Migrated `vehicle_history_entries` can disagree with DVSA; the
  opposite rule anchored to a stale figure and inflated one estimate ~34k miles.
- **Powertrain multiplier** from `vehicles.fuel_type` (ELECTRICITY ≈ 0.8 ×
  interval, HYBRID ≈ 0.9, else 1.0) — shortens rotation/balance intervals.
- Triggers (issue thresholds, org-overridable):
  - **Rotation** (never on staggered/directional fitment; flagged for staff
    when the wheel profile is unconfirmed):
    - `miles_since_baseline ≥ interval` (default 6,000 mi × multiplier). The
      baseline is the more recent of the last recorded rotation and the last
      **tyre fitting** (any `*_replaced`, two tyres or four) — only rows that
      carry a mileage count. Recent `cross_axle_diff ≥ 1.0mm` → high confidence.
    - OR a recent `cross_axle_diff ≥ 1.0mm` on its own (no mileage history
      needed) → `rotation.tread_differential`, high confidence.
    - Decided 2026-09-27 (user, options B + C): without them rotation had no
      baseline for any garage at launch and would have been silent. The
      message names the more-worn axle (front or rear).
  - **Alignment**: `axle_differential ≥ 1.5mm` · MOT advisory regex
    (uneven/edge/shoulder wear) · suspension/steering job without alignment
    event · new tyres (`*_replaced`) without alignment event.
  - **Balance** (staff prompt only): tyre replaced / wheel refurb without
    balance event · `miles_since_balance ≥ 12,000 mi`.
- **Cooldown**: no rec within 3 months or 3,000 miles of the matching
  `wheel_service_events` row, whichever is longer.
- **Evidence must be current and post-date the service it justifies**: tyre
  checks, steering work and fittings count for 180 days, MOT advisories for
  730, and nothing recorded before the last matching service counts at all
  (the spec's "at last visit").
- Every trigger returns `evidence` jsonb:
  `{ rule_key, rule_version, inputs: {...}, reason }` where `reason` is the
  plain-English sentence that goes in the message ("~7,200 miles since your
  tyres were rotated").
- Confidence: `high` = tread/event/advisory evidence; `low` = mileage
  estimate alone. Both queue for staff; the tier is future auto-send gating.

## Recommendations + queue (PR 4)

```sql
tyre_recommendations (
  id, location_id /* home branch */, organization_id,
  customer_id, vehicle_id, service_type check (in ('rotation','alignment','balance')),
  confidence check (in ('high','low')), evidence jsonb not null,
  status check (in ('pending_review','approved_sent','dismissed','converted','expired'))
    default 'pending_review',
  dismissed_reason text, reviewed_by uuid, reviewed_at timestamptz,
  book_token_hash text, sent_at, converted_booking_id, converted_at,
  created_at, updated_at
)
-- one live row per (vehicle_id, service_type): partial unique index on
-- status = 'pending_review' + the pure planner (src/lib/tyre-care-queue.ts).
-- RLS read-only for branch members; all writes via the admin client.
```

- Cron: `scheduled_tasks` `task_type='tyre_care'` → `/api/cron/tyre-care`
  via tick (`TASK_ROUTE` + automations `TASK_META`/`ensureDefaultTasks`/
  `runTaskNow` + constraint widening — same four-place checklist as #498).
  Evaluation only, no sends. Global `tyre_care` feature flag, default off.
- Config: `organizations.tyre_rotation_miles int default 6000`,
  `tyre_balance_miles int default 12000` (org columns, precedent
  `deferred_followup_days`); channels via task `settings.channels`.
- Planner: a still-due queued item is refreshed with today's evidence (and
  re-homed if the customer changed branch); a dismissal holds for 90 days; a
  recent send or booking holds for 90 days; a queued item whose trigger no
  longer holds is expired — but only for vehicles the run actually reached.
  Anonymised customers and never-serviced vehicles are evaluated as "nothing
  due". Balancing never enters the queue.
- Queue: `/staff/tyre-care` — To review / Dismissed / No longer due, with the
  evidence sentence, confidence chip, MOT-due-soon flag and live wheel-profile
  state; Dismiss with reason (quick picks incl. "Wait for MOT"), Reopen. Audit
  every action. Approve & send lands with PR 5. Nav item and the automations
  task are hidden while the `tyre_care` flag is off.
- Point-of-service balance prompt renders on the job card when the engine
  flags it (computed live, no row).

## Sends + attribution (PR 5)

- **Compose-first** (the rule from PR #594 supersedes the original
  "AI-drafted" plan): "Review & send" opens an inline composer pre-filled
  with a plain, non-AI standard wording that states the evidence (the
  trust guardrail). Staff edit freely; AI only via the shared assist menu.
  Send is blocked while a ticked channel is empty; channels without an
  address or marketing consent can't be ticked. Branch identity, the
  booking button and the unsubscribe link are appended automatically.
- Approval checks everything before anything is sent: not anonymised,
  confirmed wheel setup for rotation, consent + message per ticked channel,
  and the contact limits. Then claim-before-send (status -> approved_sent
  with the booking-token hash), send, and roll the claim back if every
  channel failed. Each channel logs to `reminders` (type `tyre_care`).
- **Contact limits**: one automated nudge per customer per 30 days across
  MOT/service/tax reminders, campaigns, deferred follow-ups, feedback
  requests and tyre care itself; at most 6 tyre-care messages a year.
  `custom` reminders (booking confirmations, manual messages, win-back)
  are deliberately excluded — they share one type and aren't nagging. The
  recommendation's own `sent_at` also counts, so the cap holds even if a
  `reminders` row fails to write. Shown on the queue before anyone clicks.
- **Unsubscribe (platform infra)**: `unsubscribe_tokens` — one 128-bit
  token per message (sha256 stored, never overwritten, so every old link
  keeps working). `/unsubscribe?u=` needs a button press (link scanners
  can't unsubscribe anyone); `/api/unsubscribe` takes the RFC 8058
  one-click POST (email only). `sendEmail`/`renderEmail` gain an optional
  `unsubscribe` → footer link + `List-Unsubscribe` headers. Tokens are
  128-bit rather than 256 because an SMS carries two links.
- Deep link: `/book?tc=<token>` lands on the home branch with the customer
  and registration prefilled and — when the branch catalogue has a matching
  service by name (rotat / align|tracking|geometry / balanc) — the service
  preselected; otherwise vehicle-only. Booking creation calls
  `markTyreRecConverted`; the token dies when the row leaves `approved_sent`.

## Metrics (PR 6)

`/staff/tyre-care/results` (linked from the queue) plus a dashboard tile for
revenue-permission roles, both behind the `tyre_care` flag. Definitions live
in the pure `src/lib/tyre-care-metrics.ts` (unit-tested), rolling 90 days per
branch:

- **Conversion** — of the messages *sent* in the window, how many led to a
  booking (the booking may land after the window). Split by service ×
  evidence (measured vs mileage estimate) — the signal for tuning intervals.
- **Revenue** — paid invoices on bookings from a tyre-care link, following
  both invoice links (booking_id directly, or booking → job → invoice), each
  invoice counted once. Not-yet-invoiced bookings reported separately as
  booked value. £ figures only for the `revenue` permission.
- **Dismissal rate** — dismissed ÷ (sent + dismissed) among staff decisions
  in the window: the false-positive proxy, with the reasons ranked.
- **Unsubscribe rate** — of the customers messaged, how many used a
  tyre-care opt-out link since: the trust canary.
- **Coverage** — from `tyre_care_runs`, one row per branch per nightly run:
  home-branch vehicles, those with service history, and those with a
  mileage estimate. The engine already visits every vehicle, so it records
  the counts rather than the page re-running it over the fleet.
- Rates under 10 show a small-sample caveat.

## Explicit MVP cuts

- Auto-send (even high confidence) · zone tread capture · SMS STOP webhook ·
  WhatsApp · external fitment API · tyre replacement recs (issue non-goal) ·
  business-hours/timezone send windows (staff click = the send window) ·
  MOT-bundled message content · per-customer snooze.

## Risks / repo gotchas that WILL bite

- Migration version: check latest on disk at PR time (parallel-PR collisions).
- Tick fan-out is a four-place checklist (constraint, TASK_ROUTE, automations
  actions, TASK_META) — miss one and the cron silently never runs.
- `reminders` type CHECK is NOT VALID — widen it or inserts fail loudly and
  dedup dies (20260609160000 comment).
- KM-unit MOT readings (imports, NI vehicles) must normalise to miles at
  ingest, not at read time.
- Mileage regression must ignore decreasing odometer pairs (clocking, typos,
  unit mixups) — clamp, don't average garbage.
- supabase-js lazy builders: fire-and-forget writes chain `.then()` (#523).
- Booking widget is public + CSP-constrained; `tc` token rides a hidden field
  through the stepper like `dw`.

## Acceptance (v1 subset of #596)

1. MOT odometer + advisories persist per vehicle; job odometer capture
   exists; estimated mileage shows on the vehicle record. (PR 2–3)
2. All three triggers evaluate on the scheduled task and write rows with
   evidence; rotation blocks on wheel profile; cooldown suppresses. (PR 3–4)
3. Staff queue lists pending recs with evidence; approve sends (consent +
   caps + unsubscribe enforced); dismiss records a reason. (PR 4–5)
4. Booking link prefills vehicle (+ service when mapped); conversion is
   attributed to the rec. (PR 5)
5. Thresholds configurable per org without deploy. (PR 4)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | mot_tests + delta/lookup ingestion + jobs.odometer + tyre_checks fixes + wheel profile + wheel_service_events | L |
| 3 | Pure rules engine + tests + vehicle-page mileage display | M |
| 4 | tyre_recommendations + cron + automations task + review queue + balance job-card prompt | L (the big one) |
| 5 | Approval sends + unsubscribe infra + booking prefill + attribution | L |
| 6 | Metrics + beta registry + docs | S |
