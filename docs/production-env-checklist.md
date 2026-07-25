# Production environment checklist

The single source of truth for what must be set before a real garage goes live.
Run the automated check, then work the runtime verifications at the bottom.

```bash
npm run check:env      # loads .env.local locally, or checks the ambient env in CI/deploy
```

It exits non-zero if any **CORE** var is missing and warns about missing
**FEATURE** vars (with the exact failure mode). The machine-readable spec lives
in [`src/lib/env-checklist.ts`](../src/lib/env-checklist.ts) and is unit-tested;
keep it in step with the code.

> Tip: to check the production env without shipping secrets anywhere, paste the
> prod env into a scratch shell and run `npx tsx scripts/check-env.ts`.

## CORE — the app does not function without these

| Var | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Database, auth, and every server write / webhook / cron. |
| `NEXT_PUBLIC_ROOT_DOMAIN` | Subdomain → organisation resolution (multi-tenant routing). |
| `APP_ENCRYPTION_KEY` | Field-level encryption (Xero tokens). **32 bytes base64** — throws hard if missing/malformed. |
| `RESET_TOKEN_SECRET` | Signs password-reset tokens. |
| `CRON_SECRET` | Gates the cron endpoints — without it anyone can trigger reminders/dunning/etc. |

## FEATURE — the feature silently degrades if missing

Grouped; see `npm run check:env` output for the per-var failure mode.

- **Payments (Stripe)** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (missing → webhook 500s, payments never confirmed), `STRIPE_TENANT_PRICE_PRO_MONTHLY`, `STRIPE_TENANT_PRICE_GROWTH_ANNUAL`. Optional: `STRIPE_PLATFORM_FEE_PERCENT` (default 2).
- **AI (Anthropic)** — `ANTHROPIC_API_KEY` (read implicitly by the SDK; assist, drafting, receptionist).
- **Email (Resend)** — `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_SENDER_NAME`, `RESEND_WEBHOOK_SECRET`.
- **Rate limiting (Upstash)** — one of the pairs `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN` **or** `UPSTASH_KV_REST_API_URL`+`UPSTASH_KV_REST_API_TOKEN`. Missing → **auth endpoints unthrottled**.
- **Vehicle data (DVLA/DVSA)** — `DVLA_VES_API_KEY`, `DVSA_CLIENT_ID`, `DVSA_CLIENT_SECRET`, `DVSA_MOT_API_KEY`, `DVSA_TOKEN_URL`, `DVSA_SCOPE`.
- **SMS/WhatsApp (Twilio)** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_WHATSAPP_FROM`.
- **Xero** — `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_SALES_ACCOUNT_CODE`.
- **Passkeys** — `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`.
- **Support** — `PLATFORM_SUPPORT_EMAIL` (missing → ticket devops email skipped), `PLATFORM_ADMIN_EMAILS`.
- **Supplier ordering** — none today: the launch (manual) connector reuses the Resend email path and `APP_ENCRYPTION_KEY`. A trade-API connector adds its credentials here — see [supplier-connectivity-spike.md](supplier-connectivity-spike.md) (#568).
- **Observability (Sentry)** — `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` (+ `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` for sourcemaps & admin issue fetch).
- **Ops alerting** — `SLACK_OPS_WEBHOOK_URL` (see issue #449).

## Set automatically — do not set by hand

`VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `NEXT_RUNTIME`, `NODE_ENV`, `CI`.

## Must NOT be set in production (dev/test/demo only)

`DEMO_MOT_FIXTURES`, `HELP_DEMO_PASSWORD`, `HELP_TENANT_SLUG`, `PREVIEW_TENANT_SLUG`, `TEST_VERBOSE`, `ROOT_DOMAIN` — the checker flags these if present.

## Beyond env vars — one-time prod setup

- [ ] **Storage bucket:** the `support-shots` bucket migration (`20260706000000_support_shots_bucket.sql`) is applied to prod, or ticket screenshot uploads fail (tickets still send, just no image).
- [ ] **All migrations applied** to prod (`supabase migration list` clean).

## Runtime verifications (do these against the deployed app)

- [ ] **Ticket devops email** — raise a support ticket in prod; confirm the email to `PLATFORM_SUPPORT_EMAIL` arrives (not just the in-app ticket).
- [ ] **Screenshot storage** — raise a ticket with the screenshot toggle on; confirm the image renders in the admin ticket detail (needs the `support-shots` bucket).
- [ ] **Auth rate limiting** — hammer the login endpoint with bad credentials; confirm you get throttled (429). If not, the Upstash vars are missing.
- [ ] **Stripe webhook** — a test payment produces a `stripe_webhook_events` row and flips the invoice to paid (see #442).
- [ ] **Email deliverability** — a real send passes SPF/DKIM/DMARC, and a hard bounce / complaint lands in `email_suppressions` (see [email-deliverability.md](email-deliverability.md), #444).
