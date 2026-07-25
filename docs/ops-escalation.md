# Ops escalation — who gets told, and what they do

Answers the third acceptance criterion of #450: when something breaks, who is
paged and what happens next.

## How an alert reaches a human

1. `/api/cron/uptime` runs every 3 minutes and evaluates every enabled rule in
   `alert_rules` (`src/lib/platform/alerts.ts`).
2. A rule that breaches its threshold — and hasn't already fired inside its own
   window — is delivered by `deliverAlert()`:
   - **Slack** when `SLACK_OPS_WEBHOOK_URL` is set and the rule names a Slack
     channel.
   - **Email** to `PLATFORM_SUPPORT_EMAIL` + `PLATFORM_ADMIN_EMAILS` when the
     rule names an email channel **or nothing else delivered**. Email is the
     floor: a rule pointed at a Slack webhook nobody configured still reaches a
     person.
   - If neither is configured the run logs `[alerts] NOT DELIVERED` and the
     rule's **Delivered** column in `/admin/health` reads `reached nobody`.
3. Rules with `auto_declare` also open an incident (deduped per rule) visible on
   the same page.

**Verify it in ten seconds:** `/admin/health` → Alert rules → **Send test
alert**. It uses the same delivery path a real firing rule uses, so a pass here
means a genuine alert would land too. Do this after any change to the ops env
vars, and once per production deploy of this area.

## The rules that exist

| Rule | Fires when | Severity |
|---|---|---|
| API availability < SLO | synthetic availability < 99.9% over 5 min | SEV-2 |
| Synthetic p95 latency | p95 > 800 ms over 10 min | SEV-3 |
| Platform 5xx error rate | Sentry error rate > 2% | SEV-2 |
| Stripe webhook failure rate | > 5% of recent webhooks failing | SEV-1 |
| DB connection pool saturation | pool > 90% | SEV-1 |
| **Scheduled job not running** | a watched cron is past its allowance | SEV-2 |

Watched crons and their allowances live in `src/lib/platform/cron-runs.ts`
(`MAX_AGE_MINS`): `cron/tick` 90 min, `cron/uptime` 20 min, `cron/quote-expiry`
90 min. The "via tick" jobs (reminders, dunning, review-requests, digest) are
deliberately **not** watched — they only run when some location's
`scheduled_tasks` fall due, so silence is normal for them.

> ⚠️ **The one gap:** this check runs *inside* `cron/uptime`, so it cannot detect
> its own death. If the platform's cron scheduler stops entirely, nothing here
> fires. Closing that needs an **external dead-man's switch** — a third-party
> monitor (Better Stack, Healthchecks.io, UptimeRobot) pinging a public health
> endpoint and alerting when the ping stops. Until that exists, a total
> scheduler outage is caught by a human noticing, not by us.

## Who responds

| Severity | Meaning | Who | Response |
|---|---|---|---|
| **SEV-1** | Money or data at risk — payments failing, DB saturated | Platform owner | Immediately, any hour |
| **SEV-2** | Customer-visible degradation — site down, errors spiking, a cron dead | Platform owner | Within the working day; same evening if it persists |
| **SEV-3** | Slow but working | Platform owner | Next working day |
| **SEV-4** | Informational | — | Review at leisure |

Single-operator platform today: every severity routes to the same person, via
the ops Slack channel and the support inbox. When a second responder joins,
split this table by rota before adding more rules — an alert with no named
owner gets ignored, which is worse than no alert.

## First moves by alert

- **Scheduled job not running** — check the Vercel cron dashboard for failed
  invocations, then `/admin/health` → Cron jobs for the last run and its detail
  line. A stopped `cron/tick` silently stops reminders, dunning and
  review-requests; a stopped `cron/quote-expiry` leaves quotes pending past
  their expiry.
- **Stripe webhook failure rate** — `/admin/health` → Webhooks, then Stripe's
  own dashboard. Failures here mean invoices aren't being marked paid.
- **DB connection pool saturation** — Supabase dashboard; look for a runaway
  query or a leaked connection from a recent deploy.
- **API availability / p95** — Vercel deployment status first, then Supabase.
- **Platform 5xx error rate** — Sentry, newest issue first.

## Keeping it honest

- Run the test alert after changing ops env vars.
- If a rule's **Delivered** column shows `reached nobody`, alerting is broken —
  fix that before anything else on this page.
- Related: [production-env-checklist.md](production-env-checklist.md) for the
  vars themselves.
