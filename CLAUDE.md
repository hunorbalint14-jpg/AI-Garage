# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev        # dev server on http://localhost:3000
npm run build      # production build
npm run lint       # ESLint (eslint-config-next + core-web-vitals)
npm run typecheck  # tsc --noEmit
npm run test:run   # vitest, single pass (npm run test for watch mode)
npm run test:e2e   # Playwright
```

Unit tests are colocated `*.test.ts` files (vitest, ~40 of them under `src/lib/`). Husky + lint-staged run ESLint and tsc on staged files at commit time.

**Multi-tenant dev:** subdomains resolve via `localtest.me`. The subdomain is the **organization** slug — access a tenant at e.g. `http://smith-motors.localtest.me:3000`. Set `NEXT_PUBLIC_ROOT_DOMAIN=localtest.me:3000` in `.env.local`.

**Database migrations:** Supabase CLI. Migrations live in `supabase/migrations/` and are date-prefixed (`YYYYMMDDHHMMSS_name.sql`). Seed data in `supabase/seed.sql`.

## Architecture

Multi-tenant SaaS for UK garages. Next.js 16 App Router + TypeScript + Tailwind 4 + shadcn/ui (`base-nova` style), backed by Supabase (Postgres + Auth), deployed on Vercel.

### Two portals (same Next.js app)
- **Staff portal** — [src/app/staff/](src/app/staff/) — garage employees. Supabase auth + 12-hour absolute session timeout enforced in [src/lib/supabase/middleware.ts](src/lib/supabase/middleware.ts) via a `SESSION_STARTED_COOKIE`.
- **Customer-facing** — [src/app/(customer)/](src/app/(customer)/), `/dashboard`, `/book`, `/quote/[slug]`, `/invoice/[id]`, `/pay/[id]` — a mix of authenticated owner routes and token-gated public routes (no login required).

### Multi-tenancy
The **tenant is the organization**, which owns one or more **locations** (branches). Root middleware [src/proxy.ts](src/proxy.ts) parses the subdomain → `organizations.slug` and injects `x-tenant-slug`. Tenant context is resolved in [src/lib/tenant-data.ts](src/lib/tenant-data.ts) (customer-facing) and [src/lib/staff-context.ts](src/lib/staff-context.ts) (staff). Staff pick an **active branch** via an `active_location` cookie (top-bar switcher → `setActiveLocation`, which re-checks membership before trusting it); `ctx.location` is that active branch, `ctx.organization` the tenant.

**Data scoping** — a customer registers once per org and is visible org-wide; operational work stays per-branch:
- **Customer-global** (`organization_id`, read via `private.is_org_staff()`): `customers`, `vehicles`, `service_plans`, `plan_subscriptions`, `reminders`. Customers are unique per `(organization_id, lower(email))`; home branch is `customers.preferred_location_id`. **`vehicles` keep `location_id`** = the *servicing branch* the reminder / MOT-delta cron route on.
- **Operational** (`location_id`, read via `private.is_location_member()`): `jobs`, `bookings`, `bays`, `services`, `products`, `tyre_checks`, …
- **Financial** (`location_id` for branch separation + `organization_id`): `invoices`, `credit_notes`, `standalone_quotes`, `finance_applications` — readable by branch members **OR** org finance.

RLS helper SQL functions (non-API-exposed `private` schema): `is_org_member` (any role) · `is_org_owner` · `is_org_admin` (owner|admin) · `is_org_finance` (owner|admin|**accountant**) · `is_org_staff` (employed anywhere in the org) · `is_location_member` (branch staff + org owner|admin) · `is_platform_admin`. **New tables must ship with RLS policies using these helpers** — schema-qualified, scoped `to authenticated`, `auth.uid()` wrapped as `(select auth.uid())`. The trigger `private.set_org_from_location` backfills `organization_id` from `location_id` on insert for the org-scoped tables (customers set it explicitly). See `docs/org-tenancy-staging-verification.md` for the migration-run gate.

### Three Supabase clients — pick the right one
- [src/lib/supabase/server.ts](src/lib/supabase/server.ts) — server components & server actions (reads cookies). Default choice.
- [src/lib/supabase/client.ts](src/lib/supabase/client.ts) — browser-side client components.
- [src/lib/supabase/admin.ts](src/lib/supabase/admin.ts) — service role, **bypasses RLS**. Only for webhooks, cron, and cross-tenant ops.

### Data flow
Server-first: server components + server actions. No client state library (no Redux/Zustand). Mutations live in `actions.ts` files colocated with the route (e.g. [src/app/book/actions.ts](src/app/book/actions.ts), [src/app/register/actions.ts](src/app/register/actions.ts)).

### Token-gated public routes
Quotes and doc-shares are accessible without login via a slug + token. The token is **never stored raw** — only `sha256(token)` is persisted. Helpers: [src/lib/quote-links.ts](src/lib/quote-links.ts), [src/lib/doc-shares.ts](src/lib/doc-shares.ts).

### Field-level encryption
Third-party OAuth tokens (currently Xero) are AES-encrypted before being written. Key is `APP_ENCRYPTION_KEY` (32-byte base64). See [src/lib/encryption.ts](src/lib/encryption.ts).

### Integrations
| Service | Used for | Entry points |
|---|---|---|
| Anthropic Claude | AI message drafting, diagnostics, voice→job, labour estimates | [src/lib/ai-messages.ts](src/lib/ai-messages.ts), `src/lib/ai-*.ts` |
| Stripe Connect Express | Per-garage payments, platform fee | [src/lib/stripe.ts](src/lib/stripe.ts), [src/app/api/webhooks/stripe/](src/app/api/webhooks/stripe/) |
| Resend | Transactional email | [src/lib/email.ts](src/lib/email.ts) |
| Twilio | SMS / WhatsApp | [src/lib/sms.ts](src/lib/sms.ts), [src/lib/whatsapp.ts](src/lib/whatsapp.ts) |
| Xero | Per-org OAuth accounting sync | [src/lib/xero.ts](src/lib/xero.ts), [src/lib/xero-sync.ts](src/lib/xero-sync.ts) |
| DVLA / DVSA | UK vehicle lookup, MOT history, recalls | `src/lib/dvla*.ts`, [src/lib/dvsa-recalls.ts](src/lib/dvsa-recalls.ts) |
| SimpleWebAuthn | Passkey auth (staff + customers) | [src/app/api/auth/passkey/](src/app/api/auth/passkey/) |

### Cron (Vercel)
Defined in [vercel.json](vercel.json), gated by a `CRON_SECRET` header check inside each handler.
- `/api/cron/tick` — hourly; fans out due `scheduled_tasks` rows to `/api/cron/reminders`, `/api/cron/digest`, `/api/cron/dunning`, `/api/cron/review-requests`
- `/api/cron/quote-expiry` — every 30 min
- `/api/cron/uptime` — every 3 min (platform reliability probes)

### Audit log
Staff actions are recorded via [src/lib/audit.ts](src/lib/audit.ts) into the `audit_log` table and surfaced at `/staff/audit-log`. New staff-side mutations should call the audit helper.
