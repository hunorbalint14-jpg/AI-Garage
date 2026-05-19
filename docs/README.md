# Share-link feature · `doc_shares`

A signed-link share gate for serving the technical doc (or any other internal HTML) from `ai-garage.co.uk` without requiring login.

## How it works

```
https://ai-garage.co.uk/docs/<slug>?t=<token>
```

- Tokens are 32 random bytes (≈43 chars, base64url).
- Stored in the DB as **SHA-256 hashes only** — the raw token is shown to the staff member *once* on creation, then never again.
- Verified in constant time. Expired, revoked, or view-exhausted links return a styled 401/410 page.
- Owners mint and revoke links from `/staff/docs` on their tenant subdomain.

## File layout (matches your repo)

```
supabase/migrations/
  20260520000000_doc_shares.sql

src/
  lib/
    doc-shares.ts                 ← mint/verify/revoke helpers + token hashing
  app/
    docs/
      [slug]/
        route.ts                  ← public, token-gated route
    staff/
      docs/
        page.tsx                  ← owner-only management UI
        actions.ts                ← server actions
        share-table.tsx           ← client component with copy / revoke buttons

docs/
  internal/
    technical-doc.html            ← the actual doc, served by the route
```

## Install steps

1. **Apply the migration**
   ```bash
   supabase db push           # or copy SQL into your prod project
   ```
   Creates `doc_shares` + `doc_shares_increment_view()` RPC.

2. **Copy the files** from this folder into your repo, preserving paths.

3. **Copy the technical doc**:
   - From this design project, take `docs/Technical Documentation.html`
   - Save it as `docs/internal/technical-doc.html` in your repo
   - Replace `brand/` references in that file with `/brand/...` (absolute) so it works under any route
   - Make sure `public/brand/aigarage-logo-horizontal-on-light.svg`, `aigarage-mark-on-brand.svg` etc. exist in your repo's `public/brand/` (your repo already has `public/brand/`)

   The relocated copy is already included as `share-feature/docs/internal/technical-doc.html` with absolute paths.

4. **Register the doc** in the route's `DOC_MAP`:
   ```ts
   // src/app/docs/[slug]/route.ts
   const DOC_MAP: Record<string, string> = {
     "technical": "docs/internal/technical-doc.html",
   };
   ```
   The `doc_key` column on `doc_shares` references one of these keys.

5. **Visit `/staff/docs`** as an org owner on any tenant subdomain. Mint a share. Copy the link from the modal that appears once (the token is **not stored**, you cannot retrieve it again — revoke and re-mint if lost).

## Security notes

- The doc lives at `docs/internal/` — **outside `public/`** — so it's not directly downloadable. Only the gated route can read it.
- `X-Robots-Tag: noindex, nofollow` is set on every served response.
- `Cache-Control: private, no-store` prevents intermediate caching of authorised responses.
- View count is incremented atomically via a server-side RPC; you can set `max_views` to cap a link (good for one-time investor / contractor shares).
- `expires_at` is checked on every request. A 7-day default is suggested in the UI.
- The token is **never logged** by the route handler.

## Access scope

The migration's RLS lets org owners manage shares for their own org (or platform-scoped shares with `organization_id = null`). The staff UI shows all shares visible under the current owner's RLS.

If you want a stricter platform-admin gate (e.g. only specific user IDs can manage platform-level docs), tighten the check at the top of `src/app/staff/docs/page.tsx` and the server actions.

## Add the nav entry

The staff sidebar lives in `src/components/staff/staff-shell.tsx`. Add an item there pointing at `/staff/docs` so owners can find the page — gate it on `role === "owner"` to keep it hidden from non-owners. Suggested label: **"Doc shares"**, suggested icon: `Share2` or `FileText` from `lucide-react`.

## Adding more docs later

1. Drop the new HTML at `docs/internal/<name>.html` (outside `public/`).
2. Register the key in `src/app/docs/[slug]/route.ts`:
   ```ts
   const DOC_MAP = {
     technical: "docs/internal/technical-doc.html",
     runbook:   "docs/internal/runbook.html",   // ← new
   };
   ```
3. Add it to the dropdown in `src/app/staff/docs/share-table.tsx`:
   ```ts
   const DOC_OPTIONS = [
     { value: "technical", label: "Technical reference" },
     { value: "runbook",   label: "Ops runbook" },     // ← new
   ];
   ```
4. Add the doc key to `ALLOWED_DOC_KEYS` in `actions.ts` so the server validates it.

## Local testing

```bash
# 1. apply migration
supabase db push

# 2. start the dev server
npm run dev

# 3. sign in as an org owner on a tenant subdomain
open http://smith-motors.localtest.me:3000/staff/docs

# 4. mint a link, copy it, paste it into an incognito window
```

Local links come back as `http://localtest.me:3000/docs/<slug>?t=<token>` so they work without DNS or HTTPS.

## Rotating a token

You can't rotate in place — that's the point. **Revoke** the old link (it goes 410 instantly) and **mint** a new one. The audit trail (`created_at`, `revoked_at`, `revoked_by`, `last_viewed_at`, `view_count`) is preserved on the revoked row.

