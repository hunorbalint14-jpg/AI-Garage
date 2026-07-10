# Garage mini-site — build spec (#507)

A large share of independent garages have no usable website; Motasoft has
sold 500+ garage sites as a paid add-on. Our tenant subdomain root today is a
thin branded splash. This plan turns it into a complete, fast, SEO-correct
marketing page built **entirely from data we already hold** — and AI writes
the copy, so a garage gets a professional page in a minute without typing a
word. Included in the tier; incumbents charge monthly.

## Decisions

- **Subdomain root only.** Custom domains stay parked per
  `docs/custom-domains.md` (#454): routing/TLS/origin-builder work is
  roadmap-sized and no pilot has asked. The issue's "custom domain serves it
  when configured" line is explicitly deferred to a future custom-domains
  feature; this plan supersedes the acceptance wording on that point.
- **Published is opt-in.** Unpublished orgs keep today's splash exactly.
  Publishing swaps the root for the mini-site; unpublishing restores the
  splash (acceptance 3's fallback).
- **One settings row per org**: `org_sites` (organization_id PK, published,
  section toggles jsonb, about_html-free `about` text, strapline, gallery
  paths[]). No layout builder — sections are fixed-order, toggleable.
  Boring on purpose: the value is "exists, fast, correct", not a CMS.
- **Performance is architecture**: RSC-only page (zero client JS beyond the
  booking CTA link), no animated background, system-font stack + one accent
  colour, images lazy + sized. Lighthouse ≥90 perf/SEO is designed-in, not
  chased after.

## Shape

### PR 1 — this spec

### PR 2 — the page + publish (L)

- `org_sites` migration (RLS: public **anon select of published rows only**
  — the page is public; writes admin-client only via settings actions).
- `src/lib/minisite-data.ts`: one loader — org + locations (address, phone,
  business_hours + special days via the business-hours engine), active
  services with from-prices per branch, google_review_url, site row.
- Tenant root: published → mini-site sections, else current splash.
  Sections (fixed order, each toggleable): hero (name/logo/strapline/Book
  now + phone), services grid with from-£, opening hours (today highlighted,
  special days honoured), branches (address, phone, WhatsApp link,
  Google-Maps link), reviews CTA (google_review_url), about, footer
  (sign-in, portal link, legal).
- Minimal settings section under Settings → Booking tab (or its own tab):
  publish toggle + per-section toggles + about/strapline textareas. Audited
  (`site.published` / `site.updated`).
- Drive: unpublished = splash byte-for-byte behaviour; publish → all
  sections render from demo-org data with zero configuration; hours match
  the business-hours engine incl. a special day; mobile 390px shot.

### PR 3 — SEO pack (M)

- Metadata: per-org title/description, canonical, OG/Twitter tags; dynamic
  OG image via `ImageResponse` (brand colour + name + strapline).
- **JSON-LD `AutoRepair`** per branch (name, address, geo-less, opening
  hours from the engine, phone, url, review link) — validated in the drive
  by parsing the script tag and checking required fields.
- Per-branch pages `/b/[locationSlug]` for multi-location orgs (own
  metadata + JSON-LD; single-location orgs skip — root is the branch page).
- `sitemap.xml` + `robots.txt` per tenant (root, branch pages, /book);
  unpublished org → noindex splash (today's behaviour made explicit).

### PR 4 — AI copy + gallery (M)

- "Write it for me": Haiku drafts strapline + about from the org's AI brief
  + services + branch count ("family-run, 30 years in Colindale…"). Editable
  before save, never auto-published; usage metered (`minisite_copy`); plain
  fallback = empty fields, sections still render.
- Gallery: up to 8 photos to a public storage bucket (same pattern as the
  eVHC media bucket), simple grid section, lazy-loaded.
- Settings polish: live "view your site" link, section previews.

## Explicit MVP cuts

- Custom domains (#454 stays parked; bundle when that feature is built).
- No page builder / themes / fonts — brand colour + logo only.
- No blog, no contact forms (phone/WhatsApp/booking are the conversion
  paths), no analytics dashboard (Vercel analytics covers it).
- No Google reviews *content* embedding (API keys + caching + ToS) — link
  out via google_review_url; revisit with #500.

## Risks / repo gotchas

- Migration version: check disk first (currently `20260712150000`).
- Tenant root is also the **platform marketing page** when no tenant
  resolves — don't disturb `getCurrentTenant() === null` path.
- Public page must not leak: loader selects only display fields; RLS anon
  policy restricted to `published = true` rows and display columns.
- `next/image` with remote Supabase storage URLs needs the images
  remotePatterns entry (check next.config); CSP img-src for the storage
  origin (memory: local 127.0.0.1 needs dev-only entries).
- Sitemap/robots routes must be tenant-aware via the same x-tenant-slug
  header, and return the marketing site's versions on the apex.

## Acceptance (from #507, amended per #454)

1. Tenant root renders a complete, fast, mobile-first page from existing org
   data with zero configuration once published. (PR 2)
2. Lighthouse ≥90 performance/SEO; JSON-LD validates (drive parses and
   asserts required AutoRepair fields). (PRs 2–3)
3. Section toggles + AI copy editable from settings; unpublish falls back to
   today's splash. (PRs 2 + 4)

## Sizing

| PR | Scope | Size |
|---|---|---|
| 1 | This spec | — |
| 2 | Page + publish + minimal settings | L |
| 3 | SEO pack: metadata, OG image, JSON-LD, branch pages, sitemap | M |
| 4 | AI copy + gallery + settings polish | M |
