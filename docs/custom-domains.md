# Custom domains — PARKED (#454)

Status, decided 2026-07-09: **not supported, deliberately**. Do not promise
custom domains to garages until this document is superseded by a built
feature.

## What exists today

- `organizations.custom_domain` — a `text unique` column from the day-one
  schema. **Nothing reads it for routing** and no UI ever set it.
- Tenant resolution (`src/lib/tenant.ts` → `resolveFromHostStrict`) only
  understands `<slug>.<ROOT_DOMAIN>`, `www.`, the apex, and `admin.`. Any
  other hostname — including a would-be custom domain pointed at the app —
  falls through to `isRootDomain: true` and renders the **marketing landing
  page**, silently. No error, no tenant.

Verified by code inspection 2026-07-09; the resolver has unit-testable
behaviour and no custom-domain branch to exercise.

## Why parked

Making it real needs all of, none of which exists:

1. **Routing**: a host → org lookup in the middleware (`proxy.ts`) for
   non-root hosts — DB/Redis-backed, on the hot path of every request.
2. **TLS + edge config**: each domain attached to the Vercel project
   (Domains API) before Vercel will even route it; per-tenant automation +
   error surfacing for misconfigured DNS.
3. **Origin builders**: `tenantOrigin()`, pay-link/checkout return URLs,
   email links — all assume `slug.<root>` and would need to prefer the
   custom domain per org.
4. **Settings UI + verification flow** (DNS instructions, pending/active
   states), and cookie/session scoping checks.

That's a real feature (roadmap-sized), not a gap-fix — and no pilot garage
has asked for it. The hosted mini-site idea (#507) overlaps; if that lands,
build custom domains as part of it.

## Parked cleanly

- App code no longer reads `custom_domain` (dead reads removed from
  `tenant-data.ts` and the settings page query). The column stays — dropping
  it is a destructive migration with zero upside, and a future build will
  want it.
- No UI mentions custom domains anywhere (checked staff + admin + marketing
  surfaces), so nothing over-promises.

## If/when unparking

Start at `resolveTenantFromHost`: add a lookup for unrecognised hosts against
`organizations.custom_domain` (cached hard — this is middleware), return the
org slug, and only then wire Vercel Domains + the settings flow. Bind it to
a paid tier (Growth) — per-domain attach has real operational cost.
