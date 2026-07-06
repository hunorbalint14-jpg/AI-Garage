# Handoff: Support Widget — "Popover" (Variant A)

Replace the `/staff/support` pages in **AI-Garage** with a floating support widget that lives in the
top-right corner of every staff page, next to the existing notifications bell. AI answers first
(from the user manual); a human ticket is always one tap away. This bundle documents the chosen
direction — **A · Popover** — in implementation detail.

## About the design files

The files in `prototype/` are **design references created in HTML** (a working interactive
prototype), NOT production code. The task is to **recreate this design inside the AI-Garage
codebase** (Next.js 16 App Router + React 19 + TypeScript + Tailwind 4 + shadcn/ui) using its
established patterns — server actions, `requireStaffContext`, lucide-react icons, the dark staff
shell. `reference/SupportLauncher.reference.tsx` is a Tailwind-flavoured translation of the
prototype to start from; treat it as a sketch to adapt, not a drop-in file.

The prototype also contains three alternate directions (B Drawer, C Palette, D Orb) behind the
bottom-center switcher — **ignore them; only Variant A ships.**

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, copy and interaction states are final and
should be matched pixel-perfectly (they extend the existing staff-shell vocabulary:
`#0e1014 / #15181d / #1c2026 / #2a2f37`, Geist + Geist Mono, mono uppercase micro-labels).

One deliberate substitution: the prototype hard-codes the demo tenant (Smith Motors, `/staff`
route, OWNER role, `#6366f1` brand). In production these come from `ctx` — see §Integration.

---

## Screens / Views

### 1. Launcher button (always visible)
- Sits **left of the notifications bell** in one cluster: `fixed top-3 right-4 z-30 flex items-center gap-2`
  (move the bell's fixed positioning up to this shared wrapper in `src/app/staff/layout.tsx`).
- 40×40 circle · bg `#15181d` · border `1px #2a2f37` · icon `LifeBuoy` 16px `#e6e8eb` · hover bg `#1c2026`.
- **Unread badge**: absolute −4px top/right, ≥17px circle, bg `#ef4444`, white 10px/700, 2px border
  `#0e1014`, shows unread ticket-reply count (cap "99+").

### 2. Peek toast (auto-appears once per new reply)
- Anchored under the cluster (top: 48px from cluster top, right-aligned), width 324px.
- bg `#15181d` · border `1px #2a2f37` · radius 12 · shadow `0 20px 48px rgba(0,0,0,.6)`.
- Row: 28px logo tile (bg `#0a0c0f`, border `#2a2f37`, AIGarage mark SVG 14px) · title
  "AI Garage Support replied" 12.5px/600 `#e6e8eb` · snippet 11.5px `#9aa1ad`, 2-line clamp ·
  actions **View reply →** (brand color, 11.5px/600) and **Dismiss** (`#5a6170`).
- Bottom progress bar: 2px track `#22262e`, fill brand, shrinks 100→0% over **6.4s linear**, then
  the toast hides. Entry: slide from `translateX(20px)` + fade, `.3s cubic-bezier(.2,.9,.3,1.15)`.
- Trigger: newest unread `ticket.reply` notification is <24h old and not yet peeked
  (localStorage `support-peek-<notificationId>`). "View reply" opens the thread and marks it read.

### 3. Popover panel
- Anchored below the launcher: `absolute right-0 top-12` within the cluster; width **382px**;
  `max-height calc(100vh − 74px)`; bg `#111418` · border `1px #2a2f37` · radius 14 ·
  shadow `0 24px 64px rgba(0,0,0,.65)`. Entry animation: fade + `translateY(-6px) scale(.97)` → none, `.18s ease-out`.
- Click-outside (transparent fixed backdrop) and `Esc` close it. Focus moves to the chat input on
  open; returns to the launcher on close. `role="dialog" aria-label="Support"` + focus trap.

**Header** (padding 12px 14px, border-b `#22262e`, bg `linear-gradient(180deg, brand@9% → transparent)`):
- 26px logo tile (as toast) · "Support" 13.5px/600 · sub-label `ANSWERS FIRST · HUMANS ON STANDBY`
  mono 9px, letter-spacing .1em, `#5a6170`.
- `TICKETS · N` button: mono 10px, border `#2a2f37`, radius 6, `#9aa1ad`, hover `#1c2026`; red 8px
  dot top-right when unread. Opens view 4.
- Close ✕ 26px ghost button.

**View 3a — Chat (default)** — scroll area padding 14, gap 10, min-height 230, max-height 390:
- Welcome bubble (assistant): "Hi {firstName} — ask me anything about AI Garage. I answer from the
  manual, and hand you to the team when it needs a human."
- **Assistant bubble**: 22px logo tile beside a bubble, max-width 84%, radius 10, border `#22262e`,
  bg `#171b21`, text 13px/1.55 `#d6dae0`. Optional **source chip** below the text: mono 9px,
  letter-spacing .08em, border `#2a2f37`, bg `#0e1116`, `#9aa1ad`, e.g. `MANUAL · SHOP §5.1 ↗`
  (links to the manual section).
- **User bubble**: right-aligned, max-width 84%, radius 10, bg `color-mix(brand 17%, #171b21)`,
  border `color-mix(brand 32%, #22262e)`, text `#e6e8eb`.
- **Typing indicator**: assistant tile + bubble with three 5px dots, opacity-blink 1.2s, staggered .2s.
- **Suggestion chips** (only while conversation is empty): mono label `ON THIS PAGE — TRY ONE`
  (9px, `#5a6170`) then 2–3 route-contextual questions as pill chips: radius 999, border `#2a2f37`,
  bg `#14181e`, 12px `#c6cad1`, hover border `#3a4049`.
- **Post-answer actions** (under the latest assistant answer only): ghost chip **That helped**
  (border `#2a2f37`, `#9aa1ad`) and brand chip **Still stuck — raise a ticket →**
  (border `color-mix(brand 55%, #2a2f37)`, bg `color-mix(brand 12%, transparent)`, `#e6e8eb`, 600).
- **Input row** (border-t `#22262e`, padding 10px 12px): text input bg `#0e1116`, border `#2a2f37`,
  radius 8, 13px, placeholder "Ask anything about AI Garage…" (`#5a6170`); Enter sends. 36px brand
  square send button (Send icon, on-brand color).
- **Footer strip** (bg `#0e1116`, border-t): left `CONTEXT ATTACHED · {route} · {ROLE}` mono 9px
  `#5a6170`; right, when unread: `1 NEW REPLY →` mono 9.5px `#ffb020` (opens the unread thread).

**View 3b — Escalate (ticket form)**:
- `← BACK TO ASSIST` mono link (9–10px `#5a6170`, hover `#e6e8eb`) · heading "Raise a ticket" 14px/600.
- Type chips: Bug / Question / Feature request — radius 7, 12px; selected: border brand,
  bg `color-mix(brand 14%, transparent)`, `#e6e8eb` 600; unselected: border `#2a2f37`, `#9aa1ad`.
- Fields with mono 9px uppercase labels (`SUBJECT`, `WHAT'S GOING ON?`): inputs bg `#0e1116`,
  border `#2a2f37`, radius 8, 13px. Validation mirrors the server: subject 3–150 chars, body ≤10,000.
- **Context box**: dashed border `#2a2f37`, radius 8, label `ATTACHED AUTOMATICALLY`; mono 9px
  chips (border `#22262e`, bg `#0e1116`, `#9aa1ad`): `ROUTE {path}`, `BRANCH {slug}`, `ROLE {role}`,
  `BUILD {sha7}`, `SENTRY · {n errors | none in last hour}`, plus a **screenshot toggle chip** with a
  15×10 thumbnail; ON: border brand, label `SCREENSHOT · ATTACHED`; OFF: `SCREENSHOT · OFF`, `#5a6170`.
- Primary button **Send to AI Garage**: full-width, brand bg, on-brand text, 13px/600, radius 8.
- Note below: `REPLIES LAND HERE AND BY EMAIL` mono 9px centered.
- Prefill when arriving from chat: type=Question, subject = last user question (≤120 chars), body =
  `Asked Assist: "…"\n\nThe answer didn't fully solve it. What I still need:\n`.

**View 3c — Sent**: centered; 38px check tile (bg `#13301f`, border `#2d5a3f`, `#5fdd9d`);
"Ticket sent" 15px/600; ref chip mono 11px (`shortTicketRef`); body 12px `#9aa1ad`
"The AI Garage team replies here and at {email} — typically the same working day." *(SLA copy is a
placeholder — confirm before shipping.)* Buttons: ghost **View my tickets** · brand **Done**.

**View 3d — Tickets list**: `← BACK TO ASSIST`; heading "Your tickets"; rows (border-t `#1c2026`,
hover `#171b21`): ref mono 10px `#5a6170` · status pill (10px/600, radius 999 — colors below) ·
amber `1 NEW` pill when unread (border `#5a4218`, bg `#3a2c14`, `#ffb020`) · relative time right ·
subject 13px/500 `#e6e8eb` · type mono 9px uppercase `#5a6170`.

**View 3e — Thread**: `← ALL TICKETS`; subject 13.5px/600 + meta row (ref, status pill, TYPE · time).
Messages `white-space: pre-wrap`, 12.5px/1.55 `#d6dae0`:
- **Platform reply** card: border `color-mix(brand 30%, #22262e)`, bg `color-mix(brand 7%, #14181e)`,
  author "AI Garage Support" 11.5px/600 `#e6e8eb`.
- **Staff message** card: border `#22262e`, bg `#171b21`, author 11.5px/600 `#9aa1ad`.
- Resolved tickets show `RESOLVED — REPLYING REOPENS THE TICKET` (mono 9px, centered); closed/declined
  block the reply row with the existing copy ("This ticket is closed — raise a new one…").
- Reply input row identical to chat input. Opening a thread marks its `ticket.*` notifications read.

### Status pill colors (dark-adjusted, from the existing globals.css overrides)
| status | background | text |
|---|---|---|
| open | rgba(120,53,15,.3) | #fcd34d |
| needs_info | rgba(30,58,138,.3) | #93c5fd |
| in_progress | rgba(76,29,149,.35) | #d8b4fe |
| planned | rgba(12,74,110,.4) | #7dd3fc |
| resolved | rgba(20,83,45,.35) | #86efac |
| closed | rgba(255,255,255,.06) | #d1d5db |

## Interactions & behavior
- Open/close: launcher click toggles; `Esc` and click-outside close; opening resets to Chat view
  (chat history persists for the session).
- Ask flow: send → typing indicator → answer with manual citation → post-answer actions. The AI
  conversation **never** sends to the team without the explicit escalate action.
- Deep links: `/staff?ticket=<id>` opens the popover on that thread (keeps existing email links
  working via a redirect from `/staff/support/[id]`).
- Mobile (`sm` and below): render the panel as a full-width bottom sheet (pattern exists in
  `ModuleSheet`); launcher stays top-right above the mobile header.
- Animations: popover popIn .18s ease-out; toast peekIn .3s; typing dots 1.2s; respect
  `prefers-reduced-motion` (disable popIn/peekIn/dots).

## State management
`SupportLauncher` (client) owns: `open`, `view: 'chat'|'escalate'|'sent'|'tickets'|'thread'`,
`messages[]`, `pendingAnswer`, `form {type, subject, body, screenshotOn}`, `sentRef`,
`activeTicketId`, `unreadCount` (server-passed, decremented on read), `peekDismissed`.
Server data via actions (no client state library — matches repo convention).

## Integration into AI-Garage (file map)
- **Mount**: `src/app/staff/layout.tsx` — render `<SupportLauncher …ctx props/>` beside the bell in
  the shared fixed cluster. Props from `ctx`: `orgSlug`, `branchName`, `orgRole`, `locationRole`,
  `userName`, `userEmail`, `brandColor`, `openTicketCount`, `unreadReplyCount`.
- **New client components** `src/components/staff/support/`: `support-launcher.tsx`,
  `support-panel.tsx`, `use-support-context.ts` (pathname, UA, `Sentry.lastEventId()`, screenshot).
- **Server actions**: move `createSupportTicketAction` + `replyToTicketAction` from
  `src/app/staff/support/actions.ts` into `src/app/staff/support-widget/actions.ts` (they already
  rate-limit, audit, and stay permission-ungated). Add `listMyOrgTickets()` and
  `getTicketThread(id)` wrappers around `src/lib/support-tickets.ts`.
- **AI endpoint**: `POST /api/support/assist` `{question, path}` → `{answer, sources[]}`.
  `requireStaffContext()`; new `assist` rate-limit bucket (~20/h/user); Claude via existing
  `src/lib/ai-*.ts` patterns; prompt embeds top ~6 staff-persona sections of
  `docs/help/manual.content.ts` ranked by keyword overlap + current route; answer ONLY from the
  manual, cite section ids, recommend a ticket when unsure; log via `src/lib/ai-usage.ts`.
- **Unread source**: `staff_notifications` kinds `ticket.reply`/`ticket.status` (badge + peek);
  exclude `ticket.*` kinds from the bell's queries to avoid double-badging; bell rows of those kinds
  get `href=/staff?ticket=<id>`.
- **Context capture**: `buildTicketContext` already carries org/branch/role/path/UA/build. Add
  `screenshot_path` (html-to-image `toPng(document.body)` captured when the form opens, uploaded to
  a private `support-shots/` bucket via signed upload; opt-out chip; skip on failure) and
  `sentry_event_id`. Render both in the admin ticket view.
- **Migration**: remove the `support` NavItem from `src/components/staff/staff-modules.ts` (and
  `ACCOUNTANT_ITEMS`); `/staff/support` → `redirect('/staff')`; `/staff/support/[id]` →
  `redirect('/staff?ticket=<id>')`.

## Design tokens
- Surfaces: page `#0e1014` · panel `#111418` · raised `#15181d` · inset/input `#0e1116` ·
  bubble `#171b21` · hover `#1c2026` · hairline `#22262e` · border `#2a2f37`.
- Text: primary `#e6e8eb` · body `#d6dae0` · secondary `#9aa1ad` · dim `#5a6170`.
- Accents: brand = tenant `ctx.branding.primaryColor` (default `#6366f1`); on-brand = luminance>.45
  ? `#0e1014` : `#e6e8eb` (mirror `onBrandColor()`); success `#5fdd9d`; amber `#ffb020`;
  destructive/badge `#ef4444`.
- Type: Geist (UI) / Geist Mono (labels, refs, context chips). Micro-labels: mono 9–10px, uppercase,
  letter-spacing .08–.14em. Body 12.5–13.5px. Radii: chips 999 · inputs/cards 8–10 · panel 14.
  Hit targets ≥36px.

## Assets
- `AIGarage-brand/mark/aigarage-mark-on-dark.svg` (already in the repo) — assistant/support avatar.
- Icons: lucide-react (already a dependency): `LifeBuoy`, `Bell`, `Send`, `X`, `Check`.

## Files in this bundle
- `README.md` — this document (self-sufficient spec).
- `reference/SupportLauncher.reference.tsx` — Tailwind/TSX translation of Variant A to adapt.
- `prototype/Support Widget.dc.html` — interactive prototype (open in a browser; variant switcher
  at the bottom — Variant A is the chosen one). `prototype/support.js` is its runtime.

## QA checklist
- [ ] Widget renders on every `/staff/*` page (incl. tablet drawer layout) without overlapping the
      command palette, booking tooltips, or confirm dialogs (keep z below dialogs).
- [ ] All location roles + org accountant can open it and file tickets (the old nav item was ungated).
- [ ] Rate-limit errors surface inline in the form/chat, not as crashes.
- [ ] Email deep-link `/staff/support/<id>` still lands on the right thread.
- [ ] Bell no longer double-counts ticket replies; peek shows once per reply.
- [ ] Ticket sends even when the screenshot upload fails or is toggled off.
- [ ] `npm run typecheck` passes; moved `actions.test.ts` permission-gate tests still pass.
