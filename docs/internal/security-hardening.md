# Security Hardening Plan

> Internal roadmap. Status: Phase 1 + Phase 2 complete. Last updated 2026-05-30.

Garage-AI is a multi-tenant Next.js 16 + Supabase SaaS handling customer PII, payments (Stripe Connect) and accounting (Xero) for UK garages. A read-only audit of auth/session, multi-tenancy/RLS and secrets/webhooks/input was performed and the HIGH/MED findings verified directly against source. This document tracks the phased remediation (4 PRs), priority-ordered so each change ships independently.

Rate limiting (Phase 2) uses **Upstash Redis** (`@upstash/ratelimit` + `@upstash/redis`).

## Already solid (no action — confirmed during audit)

- Stripe + Resend webhook signature verification before processing.
- Field encryption: AES-256-GCM, random 12-byte IV per message, auth tag, version tag (`src/lib/encryption.ts`).
- Token-gated public routes: 256-bit token, sha256-at-rest, `timingSafeEqual`, expiry (`src/lib/quote-links.ts`, `src/lib/doc-shares.ts`).
- RLS enabled broadly with `is_org_member` / `is_org_owner` / `is_location_member` helpers; admin client used only in webhook/cron/cross-tenant contexts.
- OAuth state HMAC-signed + `timingSafeEqual` (`src/lib/oauth-state.ts`) — the reuse pattern for signing/comparison.

## Findings summary

| # | Finding | Location | Risk | Phase |
|---|---|---|---|---|
| 1 | Open redirect via unvalidated `next` | `auth/handoff/route.ts`, `auth/callback/route.ts` | HIGH | 1 |
| 2 | No rate limiting / account lockout on any auth endpoint | login, forgot/reset, passkey, set-session | HIGH | 2 |
| 3 | No security headers (CSP/HSTS/XFO/nosniff) site-wide | `next.config.ts` | HIGH | 1 / 4 |
| 4 | Session-timeout cookie is unsigned (user can extend own session) | `supabase/middleware.ts` | MED | 1 |
| 5 | Cross-tenant password reset (no org-membership check) | `staff-members/actions.ts` | MED | 1 |
| 6 | Non-constant-time secret compares (CRON_SECRET, reset-token sig) | cron routes, `reset-password/actions.ts` | MED | 1 |
| 7 | Weak password floor (6) + reset token reuses CRON_SECRET, replayable | `reset-password/actions.ts` | MED | 1 / 3 |
| 8 | No schema input validation (no zod) | server actions | MED | 3 |
| 9 | CSV upload: extension-only check, no size/row cap | `customers/import/actions.ts` | MED | 3 |

---

## Phase 1 — Quick wins, no new dependencies (PR 1)

### 1.1 Security headers — `next.config.ts`
Global async `headers()` for all routes:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` (tune per feature — voice→job may need `microphone=(self)`)
- `Content-Security-Policy-Report-Only` to start. Enforced CSP risks breaking Next inline scripts + Stripe.js + Supabase; ship Report-Only, tune, flip to enforced in Phase 4.

Existing `/docs/[slug]` per-route headers are correct and more restrictive — keep them.

### 1.2 Open-redirect fix — `src/lib/safe-redirect.ts` (new)
`${origin}${next}` is exploitable; `next.startsWith("/")` is **not** sufficient (`//evil.com` and `/\evil.com` pass it).
- `safeInternalPath(next, fallback = "/staff")` — accept only single-leading-`/` paths; reject `//`, `/\`, absolute/protocol-relative URLs; else return `fallback`.
- Apply at: `auth/handoff/route.ts:30`, `auth/callback/route.ts:94`, and replace the weak check at `auth/callback/route.ts:32`.

### 1.3 Constant-time secret comparison
`safeEqual(a, b)` helper (length-check then `timingSafeEqual`).
- Cron `Bearer ${CRON_SECRET}` checks: `cron/{tick,digest,reminders,quote-expiry}/route.ts`.
- Reset-token sig compare `sig !== expected`: `reset-password/actions.ts`.

### 1.4 Sign the session-timeout cookie — `src/lib/supabase/middleware.ts`
`ai_session_started_at` is a plain unsigned timestamp. httpOnly stops JS, but a user can edit it via devtools to extend their own session past the 12h cap.
- Store `${ts}.${hmac(ts)}` (HMAC-SHA256, secret `SUPABASE_SERVICE_ROLE_KEY`, like `oauth-state.ts`).
- On read: verify sig with `timingSafeEqual`; missing/invalid → treat as expired.

### 1.5 Password floor — shared constant
- `MIN_PASSWORD_LENGTH = 12` in `src/lib/auth-constants.ts`, used by customer reset (was 6) and staff set-password (was 8). Length over complexity per NCSC guidance.

### 1.6 Scope cross-tenant password reset — `staff-members/actions.ts` `resetStaffPassword`
`listUsers({ perPage: 1000 })` finds any user project-wide and breaks past 1000 users.
- Verify the target email belongs to a member of the caller's org (scoped to `ctx.organization.id`) before generating the link; else `{ error: "User not found." }`.

---

## Phase 2 — Rate limiting + account lockout (PR 2, Upstash Redis) ✅ DONE

- Added `@upstash/ratelimit`, `@upstash/redis`; env `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (documented in `.env.example`).
- `src/lib/rate-limit.ts` — sliding-window limiter, keyed by `IP[:email]`. **Disabled** (allows all) when Upstash env unset, so local dev + un-provisioned envs work unchanged. **Fail-open** on Upstash error (logs, allows) — an outage must not lock out every login. Buckets: `login` 8/min, `email` 4/hr, `token` 20/min.
- Login moved **server-side** to gate it: `signInStaff` (`staff/login/actions.ts`), `signInCustomer` + `sendCustomerMagicLink` (`login/actions.ts`). Forgot-password → `requestPasswordReset` (`forgot-password/actions.ts`). All three client forms now call these instead of the browser Supabase client.
- Also gated: `reset-password` `updatePassword` (per-IP), passkey `login/begin` + `login/complete` (429 + `retry-after`), `set-session` (429). Removed now-dead `getStaffTenantUrl` (ungated handoff-token minter).
- Lockout = the sliding window itself + a generic `tooManyAttemptsError` message (no account enumeration).
- Tests: `src/lib/rate-limit.test.ts` (disabled-allow, `clientIp` parsing, message formatting).

## Phase 3 — Input validation, uploads, token hygiene (PR 3)

- `zod` schemas for high-value server actions (auth, staff invite, customer create/import, payments).
- CSV import: MIME check (`text/csv`), max file size, max row count.
- Reset token: dedicated `RESET_TOKEN_SECRET` (split from `CRON_SECRET`); single-use via persisted nonce/jti marked consumed.

## Phase 4 — Defense in depth & review (PR 4)

- Audit every `createAdminClient()` call site — ensure user-supplied-id queries also constrain `organization_id`/`location_id`.
- Flip CSP Report-Only → enforced after tuning.
- `npm audit` triage; bump high/critical.
- Consider `__Host-` cookie prefix; confirm Supabase prod cookie flags.

## Out of scope (deliberate)

- Backfilling identity onto historic audit rows.
- WAF / edge DDoS protection (Vercel/Cloudflare layer — infra, not code).
- External pen-test (recommend after Phase 4).
