# Handoff: Team Page Redesign (Direction B — Card Rows)

## Overview
This is a redesign of the **staff/team management page** in AI Garage
(`/staff/staff-members`). The current page renders staff in a loosely-aligned
4-column grid; the columns float in a too-wide layout so the headers don't line
up with their data, rows blend together with no visual anchor, and the action
buttons form a ragged right edge (some rows have `Edit`, some don't).

The redesign presents each staff member as a **comfortable card row** with a
role-tinted avatar, a clear identity block, an access/security chip row, and a
consistent action cluster. It also adds a **toolbar** (search + filter + member
count + invite) above the list.

This is the **approved** direction (chosen from three explored options: A
Aligned table, B Card rows, C Grouped by access). **Build B.**

---

## About the Design Files
The files in `prototype/` are **design references built in HTML/React** — a
visual prototype showing the intended look and behaviour. They are **not
production code to copy**. The task is to **recreate this design inside the
existing AI Garage codebase** (Next.js App Router + React 19 + Tailwind v4 +
shadcn, dark theme), reusing its established components and tokens.

The single file you are modifying already exists:

> **`src/app/staff/staff-members/staff-manager.tsx`** — the `"use client"`
> component that renders the staff list. All data plumbing, server actions,
> edit/invite forms, and permission logic stay exactly as they are. **You are
> only restyling the list rows + adding a toolbar.** Do not change the data
> model, the server actions in `./actions`, the `Permissions` constants, or the
> existing inline Edit / Invite / Set-password forms.

The prototype's `team-shared.jsx` / `team-directions.jsx` show the exact visual
spec; `Team Page Redesign.html` opens all three explored directions on a canvas
(B is the middle one).

## Fidelity
**High-fidelity.** Colours, spacing, type, radii and states below are final.
Recreate the card layout pixel-for-pixel using the codebase's existing tokens
and the shadcn `Button` / `Input` components — do **not** introduce new colours
or a new font.

## Screenshots
See `screenshots/` for the rendered design:
- **`direction-b-full.png`** — the full Team page: toolbar (search · role filter
  · member count · Invite) above four member cards (owner, admin, mechanic with
  skill chips, legacy staff).
- **`direction-b-overflow-menu.png`** — detail of a location-member card with
  the `Edit` button and the `⋯` overflow menu open (Set password · Reset login ·
  divider · Remove from location).

---

## Screen: Team (`/staff/staff-members`)

### Purpose
Owners/admins invite staff, see everyone's role + access + MFA status at a
glance, and manage each member (edit permissions, set password, reset login,
remove).

### Page structure (top → bottom)
The page already wraps the manager in `<div className="flex flex-col gap-6">`
with a `<PageHeader title="Team" description="Invite staff, set permissions,
and control location access." />` above it (in `page.tsx` — **keep as-is**).

Inside `StaffManager`, replace the current `flex flex-col gap-4` list block with:

```
<div className="flex flex-col gap-4">
  ├─ Toolbar            (search · filter · spacer · count · Invite)
  ├─ Card list          (flex flex-col gap-2.5)  ← the redesigned rows
  ├─ {error/success}    (unchanged)
  ├─ {setPasswordFor}   (unchanged inline form)
  ├─ {inviteLink}       (unchanged banner)
  ├─ {resetLink}        (unchanged banner)
  └─ {showInvite form}  (unchanged)
</div>
```

The current standalone `+ Invite team member` button at the bottom moves **into
the toolbar** (top-right). The bottom `<Button onClick={() => setShowInvite(true)}>`
block is removed; the invite form still appears in place when `showInvite` is true.

---

## Component specs

All measurements are from the 1040px-wide prototype. Express colours through the
existing CSS variables / Tailwind tokens (listed in **Design Tokens**) rather
than hard-coded hex.

### 1. Toolbar
A single flex row, `mb-4`, `gap-2.5`, `items-center`.

- **Search input** (left): flex `1 1 auto`, `max-w-[320px]`, height **34px**.
  - Leading magnifier icon (15px, `text-muted-foreground`), gap 8px, then the
    `<input>`.
  - `rounded-lg border border-input bg-white/[0.03] px-3 text-sm`,
    placeholder **"Search team…"**, placeholder colour `text-muted-foreground`.
  - Reuse the shadcn `Input` if it can be sized to h-34 with a leading icon;
    otherwise a plain styled input is fine.
- **Filter button** (next to search): height 34px,
  `inline-flex items-center gap-2 rounded-lg border border-input bg-white/[0.03] px-3 text-sm`.
  Label **"All roles"** + a 14px chevron-down (`text-muted-foreground`).
  Opens a menu to filter the list (see Interactions). Use the codebase's
  existing dropdown/select primitive (shadcn `DropdownMenu` or a `<select>`
  styled to match — the app already styles bare `<select>` in globals.css).
- **Spacer**: `flex-1`.
- **Member count** (right): `text-sm text-muted-foreground`, text =
  `` `${visibleCount} member${visibleCount === 1 ? '' : 's'}` ``. When a search/
  filter is active, show the filtered count (e.g. "2 members"); otherwise total.
- **Invite button** (far right): the existing shadcn `<Button>` (default
  variant = light primary in dark mode), height ~34px, content
  `<PlusIcon /> Invite team member`, `onClick={() => setShowInvite(true)}`.

### 2. Member card (the core element)
One card per row in the prototype's `MEMBERS` list. In the real component this
is rendered for **each org-level entry** (owner/admin → `entry.orgRole`) **and
each location entry** (`entry.locationEntries.map(...)`), exactly as the current
code branches. The card markup is identical; only the *content* of the
access/role region differs between org rows and location rows.

**Card container:**
- `flex items-center gap-4`
- `rounded-xl border bg-card px-[18px] py-4` (border = `--border`, the default)
- gap between cards: parent `flex flex-col gap-2.5`
- subtle hover: `hover:bg-white/[0.015]` (optional, keep light)

**Left — Avatar (46px circle):**
- `h-[46px] w-[46px] shrink-0 rounded-full flex items-center justify-center`
- Background and text **tinted to the member's role** (see Role colour map).
  Background = role colour at **13% alpha**; text = role colour at full; plus
  `inset 0 0 0 1px <roleColour>/28%` ring (box-shadow).
- Content = initials (first letters of full name, max 2, uppercase). The app
  already computes `userInitials` in `staff/layout.tsx` the same way — reuse
  that logic: `name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2)`.
  Fall back to the email's first 1–2 chars if no name.

**Middle — Identity + access (`flex-1 min-w-0`):**
1. **Name row** — `flex items-center gap-2.5 flex-wrap`:
   - Name: `text-[15.5px] font-semibold text-foreground`.
   - If `entry.isCurrentUser`: `(you)` in `text-xs text-muted-foreground`.
   - The existing `(staff)` suffix on some names stays as
     `text-xs text-muted-foreground`.
   - **RoleBadge** immediately after the name (moved up here from its own
     column — see RoleBadge spec). Keep the existing `RoleBadge` component and
     its colour map verbatim.
2. **Sub-line** — `mt-[3px] text-[12.5px] text-muted-foreground`:
   `` `${email} · ${scope}` `` where scope = `"All locations"` for org rows or
   `loc.locationName` for location rows. Use a real middot `·` with spaces.
3. **Access chip row** — `mt-2.5 flex flex-wrap items-center gap-2`:
   - **Access summary**: org rows show **"Full access"**
     (`text-xs text-[oklch(0.82_0_0)]`); location rows show the **PermCount**
     chip (green dot + `` `${enabledCount} permissions` ``), using the existing
     `enabledCount = Object.values(loc.permissions).filter(Boolean).length`.
   - **Skill chips** (location rows only): `MOT tester`, `QC reviewer` (blue),
     `EV L{n}` (green if qualified/in-date, amber if expiring — reuse existing
     `isHvQualified` / `qualExpired` logic). See SkillChip.
   - **MFA badge**: `MFA on` (green) when `entry.hasMfa`, else `No MFA` (muted).
     Show on **every** card — it's a security column now, not org-only.

**Right — Action cluster (`self-start` or `items-center`):**
`relative inline-flex items-center gap-1.5`. Consistent on every row:
- **Edit** button — visible **only for location rows** (where the current code
  shows Edit), `variant="outline"` shadcn, height 30px, text "Edit". Toggles the
  existing inline edit panel (`startEdit(...)` / `cancelEdit()`). Org rows have
  no Edit.
- **`⋯` overflow menu** — always present except for the current user. A 30px
  ghost icon button (3 vertical dots, `text-muted-foreground`, hover
  `bg-muted text-foreground border border-border`). Opens the actions menu.
- **Current user row**: no actions — render a muted `—` (matches prototype) or
  simply nothing. (Mirrors current behaviour: `!entry.isCurrentUser` gates all
  actions.)

### 3. Overflow menu (`⋯`)
A popover anchored bottom-right of the trigger. Use the codebase's existing
`DropdownMenu` (shadcn / base-ui) — the prototype draws it manually only because
it has no menu primitive.

- Surface: `bg-popover border border-[--border] rounded-[10px] shadow-[0_16px_40px_rgba(0,0,0,0.55)] p-[5px] min-w-[168px]`.
- Items: `px-2.5 py-[7px] rounded-md text-[13px]`, hover `bg-white/[0.06]`.
- A `1px` divider (`bg-border`) before the destructive item.
- **Item set per row type** (these map 1:1 to the existing handlers — do not
  invent new actions):
  - **Org admin/owner (non-self):** `Set password`, `Reset login`,
    `Reset MFA` *(only if `entry.hasMfa`)*, divider, **`Remove from organisation`**
    (destructive, `text-destructive`). → calls `setSetPasswordFor`,
    `handleResetLogin`, `handleResetMfa`, `handleRemove(userId, null, name)`.
  - **Location member:** `Set password`, `Reset login`, `Reset MFA` *(if MFA)*,
    divider, **`Remove from location`** (destructive). → same handlers with
    `handleRemove(userId, loc.locationId, name)`.
  - Owners and the current user keep the existing guards (no Remove for owner;
    nothing for self).

### RoleBadge (reuse existing — do not restyle)
Keep `RoleBadge` and its `styles` map exactly as in the current file. It already
produces `rounded px-2 py-0.5 text-[11px] font-medium` badges with the
per-role colour pairs. The redesign just **relocates** it next to the name.

### SkillChip / MfaBadge / PermCount
These already exist inline in the current code (the MOT/QC/EV `<span>`s, the
`PermDot` + "{n} perms"). Keep their colour values. Two small copy/shape tweaks:
- "8 perms" → **"8 permissions"** (full word; chip shape unchanged).
- MFA badge gets a small leading status dot (5px) before the label, matching the
  PermCount dot, for visual consistency. Colours unchanged.

---

## Interactions & Behavior

- **Search**: client-side filter over the rendered entries. Match
  case-insensitively against **full name + email** (and optionally location
  name). Filtering happens on `entries` before the `.map`. Update the toolbar
  count to the filtered length. No debounce needed (client-side, small list);
  if you prefer, debounce 150ms. Empty result → show the existing
  "No staff found." empty state copy adapted to "No members match your search."
- **Filter dropdown**: filters by **role** (`owner`, `admin`, plus the
  `ROLE_OPTIONS` values) — default label **"All roles"**. If the org has >1
  location, optionally offer a **location** filter too (Direction C grouped by
  location is the fuller treatment; here a flat filter is enough). Selecting a
  value narrows the list + updates the count.
- **Edit**: unchanged — toggles the existing inline expand panel below the row
  (role select, template apply, PermissionsGrid, MOT, EV, Save/Cancel). When a
  card is expanded, the inline panel should render **below the card**, visually
  attached (e.g. the editing card gets `rounded-b-none` and the panel
  `rounded-t-none -mt-px`), or simply render the existing panel in a bordered
  block directly under the card with `gap` removed for that pair.
- **Overflow menu**: opens on click, closes on outside-click / Esc / item
  select. All items call the existing handlers (which already show
  `confirm()` dialogs for destructive actions and flash success messages).
- **Hover states**: card `hover:bg-white/[0.015]`; ghost `⋯` button
  `hover:bg-muted hover:text-foreground`; outline Edit uses shadcn outline hover
  (`dark:hover:bg-input/50`); menu items `hover:bg-white/[0.06]`, destructive
  item `hover:bg-destructive/10`.
- **Focus states**: keep shadcn defaults (`focus-visible:ring-3 ring-ring/50`)
  on all interactive elements; search input `focus-visible:ring-1 ring-ring`.
- **Loading**: existing `pending` (useTransition) already disables buttons +
  shows `AigSpinner` via `Button loading`. Keep wiring menu/edit actions through
  `pending`.
- **Responsive**: below `~640px` the card collapses to a 2-row stack — avatar +
  identity on row 1, access chips + actions wrap to row 2. The current component
  already uses `grid-cols-1 md:grid-cols-[...]`; with the card/flex layout use
  `flex-wrap` + allow the action cluster to drop full-width and right-align.
  Keep tap targets ≥ 44px on mobile (bump Edit/`⋯` to h-9 under `sm`).

## State Management
No new server state. Add to the existing `StaffManager` local state:
- `search: string` — toolbar query (`useState("")`).
- `roleFilter: string` — selected role filter or `"all"` (`useState("all")`).
- `openMenuKey: string | null` — which row's overflow menu is open (or rely on
  the `DropdownMenu` primitive's own open state, preferred).
All existing state (`editingKey`, `editPerms`, `showInvite`, `setPasswordFor`,
`inviteLink`, `resetLink`, `pending`, etc.) stays unchanged.

Derive the rendered list:
```ts
const visible = entries.filter(e => {
  const hay = `${e.fullName ?? ""} ${e.email}`.toLowerCase();
  const okSearch = hay.includes(search.trim().toLowerCase());
  const okRole = roleFilter === "all"
    || e.orgRole === roleFilter
    || e.locationEntries.some(l => l.role === roleFilter);
  return okSearch && okRole;
});
```
`visibleCount` = number of rendered rows (count flattened org + location rows if
you want it exact, or count members).

---

## Design Tokens
Use the existing `globals.css` variables. Exact dark-theme values for reference:

**Neutrals (OKLCH):**
| Token | Variable | Value |
|---|---|---|
| Background | `--background` | `oklch(0.145 0 0)` |
| Card surface | `--card` | `oklch(0.205 0 0)` |
| Foreground | `--foreground` | `oklch(0.985 0 0)` |
| Muted | `--muted` | `oklch(0.269 0 0)` |
| Muted foreground | `--muted-foreground` | `oklch(0.708 0 0)` |
| Border | `--border` | `oklch(1 0 0 / 18%)` |
| Input border | `--input` | `oklch(1 0 0 / 30%)` (prototype softens to ~22%) |
| Ring | `--ring` | `oklch(0.7 0 0)` |
| Destructive | `--destructive` | `oklch(0.704 0.191 22.216)` |
| Primary (button) | `--primary` | `oklch(0.922 0 0)` (text `--primary-foreground` `oklch(0.205 0 0)`) |
| Radius base | `--radius` | `0.625rem` (10px); cards use `rounded-xl` (~14px) |

**Role colours (dark; from globals.css overrides — already in `RoleBadge`):**
| Role | Text | Badge bg | Avatar bg (13%) |
|---|---|---|---|
| owner (amber) | `rgb(253 211 77)` | amber/0.13 | `rgb(253 211 77 / 0.13)` |
| admin (blue) | `rgb(147 197 253)` | blue/0.13 | `rgb(147 197 253 / 0.13)` |
| mechanic (green) | `rgb(134 239 172)` | green/0.13 | `rgb(134 239 172 / 0.13)` |
| staff/legacy (muted) | `oklch(0.78 0 0)` | `white/0.07` | `white/0.07` |

**Chip / status colours:**
- Skill blue (MOT/QC): text `rgb(147 197 253)`, bg `rgb(147 197 253 / 0.12)`.
- Skill/MFA green: text `rgb(134 239 172)`, bg `rgb(134 239 172 / 0.12)`,
  dot `rgb(134 239 172)`.
- EV expiring (amber): text `rgb(253 211 77)`, bg amber/0.12.
- No-MFA muted: text `--muted-foreground`, bg `white/0.05`.

**Spacing / sizing:**
- Card padding `18px` horizontal / `16px` vertical; card gap `10px`.
- Avatar `46px`; gap avatar→identity `16px`.
- Toolbar height `34px`; toolbar gap `10px`; toolbar `mb-4`.
- Name `15.5px/600`; sub-line `12.5px`; chips `10.5–12.5px`; access row `mt-2.5`.
- Edit/`⋯` buttons `30px` (≥44px on mobile).
- Menu radius `10px`, shadow `0 16px 40px rgba(0,0,0,0.55)`.

**Typography:** existing app fonts — **Geist** (`--font-geist-sans`) for UI,
**Geist Mono** (`--font-geist-mono`) for the invite/reset links `<code>` only.
No new fonts.

## Assets
- **None new.** Icons (search, chevron, plus, dots) should come from the icon
  set the codebase already uses (e.g. `lucide-react` if present, else inline
  SVG matching the existing style). Prototype uses simple stroked SVGs:
  `Search`, `ChevronDown`, `MoreVertical` (3 dots), `Plus`.
- Fonts already loaded by `src/app/layout.tsx` (`Geist`, `Geist_Mono`).

## Files

**In the codebase (modify / reference):**
- `src/app/staff/staff-members/staff-manager.tsx` — **the file to edit** (list
  rows + new toolbar). All else stays.
- `src/app/staff/staff-members/page.tsx` — data + `PageHeader` (no change).
- `src/app/staff/staff-members/actions.ts` — server actions (no change).
- `src/app/staff/staff-members/constants.ts` — permissions (no change).
- `src/components/ui/button.tsx`, `input.tsx`, `label.tsx` — reuse.
- `src/app/globals.css` — token source + the dark badge-colour overrides.

**In this bundle (design reference):**
- `prototype/Team Page Redesign.html` — opens all 3 directions on a canvas;
  **B (middle artboard) is the approved one**.
- `prototype/team-shared.jsx` — exact primitives: `Avatar`, `RoleBadge`,
  `SkillChip`, `MfaBadge`, `PermCount`, `Toolbar`, buttons, the `MEMBERS` sample
  data, and the menu item sets (`MENU_FULL` / `MENU_SCOPED`).
- `prototype/team-directions.jsx` — `DirectionCards` is the B spec (card markup,
  spacing, `Identity`/`Actions`/`AccessCell` helpers).
- `prototype/design-canvas.jsx` — canvas harness only (not part of the design).

## Implementation checklist
- [ ] Add toolbar (search + role filter + count + Invite) above the list; remove
      the bottom standalone Invite button (invite form still opens in place).
- [ ] Convert each org/location row from the 4-col grid to the card layout.
- [ ] Move `RoleBadge` next to the name; keep its colour map.
- [ ] Add 46px role-tinted initials avatar.
- [ ] Build the access chip row (Full access / N permissions + skills + MFA on
      every card).
- [ ] Collapse Set password / Reset login / Reset MFA / Remove into a `⋯`
      `DropdownMenu`; keep `Edit` visible on location rows; nothing for self.
- [ ] Wire search + role filter to derive the rendered list + count.
- [ ] Preserve all existing server actions, edit panel, invite/reset/password
      forms and `pending` wiring.
- [ ] Verify mobile stacking + ≥44px tap targets.
