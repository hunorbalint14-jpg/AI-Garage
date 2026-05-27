# Garage-AI

AI-powered cloud SaaS for UK garages — MOT/service tracking, automated reminders, and AI-assisted client communication.

The app is multi-tenant (white-label per garage with custom subdomains and branding) and serves two audiences: garage staff and the garage's own customers (vehicle owners).

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **Supabase** (Postgres + Auth + Row-Level Security)
- **Claude API** (`@anthropic-ai/sdk`) for AI client communication
- **Resend** for email, **Twilio** for SMS + WhatsApp
- **Stripe Connect** for customer-to-garage payments
- **Xero** for accounting sync
- **DVLA MOT History API** + **DVLA VES** for UK vehicle data
- **Vercel** for hosting
- **Vitest** + **GitHub Actions** for tests + CI

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` and fill the required keys before running. For tenant-aware local dev use `*.localtest.me:3000` (e.g. `http://acme.localtest.me:3000`) — `localtest.me` resolves any subdomain to `127.0.0.1`, no hosts-file edits needed.

## Project structure

- `src/app/staff/**` — garage staff portal (tenant-scoped admin UI)
- `src/app/book`, `src/app/dashboard`, `src/app/quote/**` — customer-facing routes
- `src/app/api/**` — webhook + cron + auth endpoints
- `src/lib/**` — shared libs (Supabase clients, permissions, tenant resolution, integrations)
- `src/proxy.ts` — subdomain → tenant resolution middleware
- `supabase/migrations` — SQL migrations (schema + RLS policies)
- `src/test/helpers/**` — shared test mocks (Supabase + staff-context)

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run start` | Run prod build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | One-shot run |
| `npm run test:coverage` | Run + v8 coverage report (`coverage/index.html`) |
| `npm run test:ui` | Vitest browser UI |

## Testing

Tests live next to source as `*.test.ts` / `*.test.tsx`. The suite covers:

- **`src/lib/**`** — pure-function unit tests (permissions, tenant resolution, quote tokens, encryption round-trips, OAuth state, doc-share gating, cron schedule math, UK plate validation, slug validation, Stripe fee math, URL builders).
- **`src/app/staff/**/actions.ts`** — permission-gate smoke tests for every mutating server action. Each test mocks the Supabase admin client + audit log and asserts the action returns `{ error: "Permission denied." }` when ctx lacks the gated permission.

Add new tests next to the file under test. For server actions, copy the pattern from any existing `actions.test.ts`:

```ts
vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
// ...other deps

const { requireStaffContext } = await import("@/lib/staff-context");
const { myAction } = await import("./actions");

it("denies without my_perm", async () => {
  vi.mocked(requireStaffContext).mockResolvedValue(
    mockStaffContextMember({ my_perm: false }),
  );
  expect(await myAction(args)).toEqual({ error: "Permission denied." });
});
```

Test helpers under `src/test/helpers/`:

- `mockStaffContext(overrides)` — owner-by-default ctx
- `mockStaffContextMember(perms)` — non-org user with explicit permissions
- `createSupabaseMock(canned)` — fluent-builder mock for the admin client

## CI

`.github/workflows/ci.yml` runs on every push + PR:

| Step | Gate |
|---|---|
| `npm run typecheck` | **Hard** — blocks merge |
| `npm run test:coverage` | **Hard** — blocks merge |
| `npx eslint src/` | Soft (continue-on-error while Next 16 strict warnings backlog is cleared) |
| Upload coverage artifact | 14-day retention |

Concurrency group cancels in-progress runs on force-push.

**Branch protection** — after merging the CI PR, enable required status check `ci / ci` on `main` via GitHub → Settings → Branches → branch protection rule.

## Pre-commit hooks

`.husky/pre-commit` runs `npx lint-staged` which scopes `eslint --fix` + `tsc --noEmit` to staged `.ts` / `.tsx` files. Catches issues before they reach CI.

Bypass with `git commit --no-verify` when needed (e.g. WIP commits).

## Tenant resolution

Hosts ending in `${NEXT_PUBLIC_ROOT_DOMAIN}` (e.g. `acme.ai-garage.co.uk`) resolve to the `acme` tenant. For Vercel Preview deploys, set `PREVIEW_TENANT_SLUG` in the Preview env scope to pin a single garage on every preview URL — see `src/lib/tenant.ts`.

## Permissions model

Two-tier:

- **Org-level**: `owner` / `admin` (in `org_users`) — full access across every location in the org.
- **Location-level**: `manager` / `service_advisor` / `mechanic` / `apprentice` / `receptionist` / `parts` / `bookkeeper` / `staff` (in `location_users`) with a `permissions` JSONB column listing 23 capability keys.

`hasPermission(ctx, key)` returns `true` for any org-level user. Hard-locked perms (`staff_manage`, `org_settings`, `gdpr_actions`) can only be granted via orgRole — never via a location template. See `src/lib/permissions.ts`.

Templates live in `role_templates` — eight system templates ship with UK garage defaults plus owner-defined custom templates. Manage at `/staff/settings/team-roles`.
