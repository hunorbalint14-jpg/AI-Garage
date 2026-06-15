# User manual generator

Generates the end-to-end user manual (`/docs/userguide?t=…`, served through the
doc-shares gate) from a single section manifest + auto-captured screenshots.

## Pieces

| File | Role |
|---|---|
| `docs/help/manual.content.ts` | **Source of truth.** One entry per section (both portals): title, purpose, numbered steps, route, persona. Drives capture *and* the HTML. |
| `scripts/seed-demo.ts` | Builds a deterministic, populated demo tenant on `smith-motors`. **Local Supabase only** (hard-guarded). |
| `scripts/demo-constants.ts` | Shared demo logins/tenant, imported by the seed *and* the capture login. |
| `playwright.screenshots.config.ts` + `e2e/screenshots/*` | Logs in (staff + customer) and screenshots every section → `docs/internal/help-images/`. Separate from the smoke suite; never runs in CI. |
| `scripts/build-help-doc.ts` | Inlines the PNGs (data URIs) and writes the self-contained `docs/internal/user-guide.html`. |

## Run it (locally)

The seed creates auth users with the service-role key, so it **refuses any
non-local Supabase**. Point the app at a local instance first:

```bash
supabase start                 # local Postgres + Auth (config.toml is committed)
supabase db reset              # apply migrations + supabase/seed.sql (the two base orgs)

# ⚠️ Restore the API-role grants (see "Gotchas" below) — a fresh local reset
# doesn't grant anon/authenticated/service_role on public tables like the cloud
# baseline does, so the seed (and the app) get "permission denied" without this:
docker exec -i "$(docker ps --format '{{.Names}}' | grep supabase_db)" \
  psql -U postgres -d postgres <<'SQL'
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL

# point .env.local at the local stack (back up your cloud one first):
#   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#   NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY = values `supabase start` printed
#   NEXT_PUBLIC_ROOT_DOMAIN=localtest.me:3000   (leave as-is)
# stop any running `npm run dev` first (capture boots its own, reuseExistingServer).

npm run help:gen               # seed → capture → build
# or individually:
npm run help:seed
npm run help:capture           # boots `npm run dev`, drives the seeded tenant
npm run help:build
# afterwards: restore your cloud .env.local
```

## Gotchas

- **Grants.** As above — `supabase db reset` on a fresh local stack leaves the
  API roles without `SELECT/INSERT/...` on the app's tables (cloud projects get
  these from the platform baseline, not a migration). Run the grant block once
  per reset or the seed fails at the first query with `permission denied`.
- **The seed is local-only.** It uses the service-role key + creates auth users,
  so it refuses any non-local `NEXT_PUBLIC_SUPABASE_URL`.

Demo logins (also printed by the seed): `owner@smith-motors.demo` /
`demo.customer@smith-motors.demo`, password `DemoPassw0rd!`.

Capture hits the tenant at `http://smith-motors.localtest.me:3000`, so keep
`NEXT_PUBLIC_ROOT_DOMAIN=localtest.me:3000` in `.env.local`.

## Output

- `docs/internal/user-guide.html` — the committed artifact (self-contained;
  served via the gate). The builder runs without screenshots too, emitting
  "screenshot pending" placeholders, so content and capture can advance apart.
- `docs/internal/help-images/**` and `e2e/screenshots/.auth/**` are intermediate
  and gitignored.

## Share it

`/staff/docs` → mint **"User manual"** → copy the one-time link. Revoke any time.

## Add a section

Append one entry to `docs/help/manual.content.ts` (id, title, purpose, steps,
route, persona) and re-run `npm run help:gen`. The screenshot filename is
`<portal>/<id>.png`; dynamic detail pages use `capture.clickToDetail` to drill in
from a listing route.
