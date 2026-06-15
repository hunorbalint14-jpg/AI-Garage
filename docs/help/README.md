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
supabase start                 # local Postgres + Auth
supabase db reset              # apply migrations + supabase/seed.sql (the two base orgs)
# set NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local to the
# local instance (supabase start prints them)

npm run help:gen               # seed → capture → build
# or individually:
npm run help:seed
npm run help:capture           # boots `npm run dev`, drives the seeded tenant
npm run help:build
```

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
