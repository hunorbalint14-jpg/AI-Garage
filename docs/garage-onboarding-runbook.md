# Garage onboarding runbook

Step-by-step order to bring a new garage live. Written for whoever runs
onboarding (us today, a CS hire tomorrow). Every step names the exact screen.

**Dry-run result (2026-07-07, fresh org on local):** signup → usable dashboard
in **~90 seconds** of actual flow time. No dead ends. The slow parts of a real
onboarding are the garage's own inputs (services list, Stripe KYC, customer
CSV) — plan ~45–60 min with the owner on a call.

---

## Phase 0 — before you start (platform side, once per environment)

- [ ] Production env checklist complete ([#445](https://github.com/hunorbalint14-jpg/AI-Garage/issues/445), `docs/production-env-checklist.md`, `npm run check:env`).
- [ ] Wildcard DNS `*.{ROOT_DOMAIN}` points at Vercel (tenant subdomains resolve).
- [ ] Stripe **platform** account live; Connect enabled.
- [ ] You have: garage's legal/trading name, preferred subdomain, owner's name + email, branch address, opening hours, services + prices, logo file, and (if importing) their customer book as CSV.

## Phase 1 — create the organisation (~2 min)

1. Send the owner to **`https://{ROOT_DOMAIN}/signup`** (or drive it together).
2. Fields: **Business name · Subdomain (slug) · Your name · Email · Password.**
   - Slug = the tenant subdomain forever (`{slug}.{ROOT_DOMAIN}`); lowercase,
     hyphens; uniqueness is checked against orgs, branches **and retired
     slugs** — a conflict errors immediately, pick another.
3. Submitting creates the org + its first branch (same slug) + the owner
   membership, sends the **platform welcome email**, and lands on
   `https://{slug}.{ROOT_DOMAIN}/staff/login` with the email prefilled.

## Phase 2 — first login gates (~2 min, in this exact order)

Sign in on the tenant subdomain. The portal walks the owner through:

1. **Select branch** — single-branch orgs click straight through.
2. **DPA acceptance** — tick + accept (legal gate; nothing else loads first).
3. **AI setup survey** — specialisms, tone, promotions. This writes the
   per-org AI brief that every AI feature injects; honest answers matter.
   Editable later: Settings → Business → *Edit AI setup*.

Lands on the dashboard. Everything below happens inside **/staff**.

## Phase 3 — business setup (~15 min)

Settings (gear icon) unless noted.

| # | What | Where | Notes |
|---|---|---|---|
| 1 | Branding: colour, logo, phone, Google-review URL, privacy URL | Settings → **Business** | Colour + logo brand the widget, portal and emails. |
| 2 | Opening hours | Settings → **Booking** | Per-day; absent day = closed. Widget + slot picker enforce these. |
| 3 | Special days / holidays | Settings → **Booking** → special hours | Dated overrides (closed or custom hours). |
| 4 | Services + prices | **Shop → Services** | Name, category, duration, price. Category feeds the booking `type`; price drives pay-now. |
| 5 | Bays | **Shop → Bays** | Bays power the schedule timeline + slot capacity. No bays = capacity checks pass everything (legacy mode) — set them up. |
| 6 | Team | **Admin → Team** → *Invite team member* | Role templates set permissions; add branch access per member. Owners/admins are org-wide. |
| 7 | Extra branches (chains) | Settings → **Locations** | Each branch gets its own slug, hours, services, bays. |

## Phase 4 — payments (~10 min + Stripe review time)

1. Settings → **Payments & Quotes** → *Connect Stripe* → complete the Express
   onboarding (KYC, bank account).
2. Done when the section shows **charges enabled** (and payouts enabled).
   Until then the widget quietly books without payment — no error, just no
   pay-now step.
3. Optional, same tab: quote deposits %, quote validity days, reminder
   cadence, no-show fee.

## Phase 5 — customer book import (~10 min for a clean CSV)

1. **Ops → Customers → Import** (`/staff/customers/import`).
2. Header (sample downloadable on the page):
   `full_name,email,phone,registration,make,model,year,mot_expiry,service_due`
3. Customers are unique per org by email; vehicles attach by registration.
   MOT/service dates power the reminder engine + the customer portal from day
   one — worth cleaning before import.
4. After import, the nightly **mot-delta** cron enriches vehicles against
   DVLA/DVSA automatically; no manual step.

## Phase 6 — go-live test (~10 min) — do not skip

Run one **real end-to-end booking** on the live tenant:

1. Open `https://{slug}.{ROOT_DOMAIN}/book` in a private window. Header must
   show the garage's real opening hours.
2. Book as a throwaway customer: reg lookup (*Find my car*) → pick a priced
   service → pick a slot (closed days must show ✕, taken slots struck
   through) → **CTA must name the slot** (`Pay £54.85 — …` when Stripe is
   live) → pay with Stripe test card `4242 4242 4242 4242` (test mode) or a
   real card refunded after (live mode).
3. Verify, in order: confirmation email arrives (names the **branch +
   address**) → booking on **Ops → Bookings** (Day view) → start the job →
   complete it → **Jobs** board shows it in *Done · unbilled* with the £ value
   → click **INVOICE →** → send the invoice → open the pay link → pay →
   status flips to paid.
4. If the customer abandoned Stripe mid-payment: the booking shows **Unpaid**
   in the customer portal with a *Complete payment* link — that flow is the
   recovery path, no manual fix needed.
5. Delete/refund the test artefacts (cancel the booking, void or refund the
   invoice), or keep them as training data with an obvious name.

## Phase 7 — after go-live

- The **uptime probe** picks the new tenant up automatically (it probes every
  org subdomain) — nothing to configure.
- Show the owner: dashboard, *What's new*, the support widget (bottom-right)
  for tickets, and **Settings → Compliance → Your data** (their exportable
  data — the exit-path trust point).
- Embed the widget: link or iframe `https://{slug}.{ROOT_DOMAIN}/book` from
  the garage's site / Google Business profile.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Slug rejected at signup | Conflicts with an org, a branch, or a retired slug — pick another; don't recycle old slugs. |
| Widget books but never asks for payment | Stripe not fully onboarded — check *charges enabled* in Settings → Payments & Quotes. |
| Slot picker shows everything closed | Opening hours never saved (defaults are Mon–Sat 08:00–18:00 only until first save) or a special-day override — Settings → Booking. |
| Booking stuck `payment_pending` | Customer abandoned Stripe. Self-heals via the portal's *Complete payment* link / `/book/{id}/pay`; or cancel it staff-side. |
| Import rejects rows | Header must match the sample exactly; dates ISO (`YYYY-MM-DD`); duplicate emails merge into one customer. |
| Repeated logins fail on local dev | Local GoTrue rate limit — wait a minute. Not a production behaviour. |

## Dry-run log

| Date | Environment | Time to dashboard | Dead ends |
|---|---|---|---|
| 2026-07-07 | local (fresh org `runbook-motors`) | ~90s flow time (signup 19s · gates ~40s · survey ~30s) | none — gate order confirmed: select-branch → DPA → AI survey |
