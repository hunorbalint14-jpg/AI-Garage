# AIGarage brand assets

The official **FrameG** logo system as standalone SVGs. Vector everywhere — rasterize to PNG/ICO when a platform demands it (`sharp`, `svgexport`, `rsvg-convert`).

The font dependency is **Space Grotesk** (loaded inline in each SVG via Google Fonts; falls back to Inter → system-ui if offline). If you need true font independence for print, run the SVGs through a "convert text to outlines" pass first.

---

## Pick-the-right-file table

The fastest way to choose: match your background, then your context.

| Context | Background | Use this file |
|---|---|---|
| Website header — dark theme | `#0b0d11` / dark | `logo/aigarage-logo-horizontal-on-dark.svg` |
| Website header — light theme | `#FFFFFF` / paper | `logo/aigarage-logo-horizontal-on-light.svg` |
| Mobile splash / standalone brand moment | dark | `logo/aigarage-logo-stacked-on-dark.svg` |
| Mobile splash / standalone brand moment | light | `logo/aigarage-logo-stacked-on-light.svg` |
| Email banner (marketing) | dark | `logo/aigarage-logo-horizontal-on-dark.svg` |
| Transactional email header | white | `logo/aigarage-logo-horizontal-on-light.svg` |
| Invoice header (print + screen) | white | `logo/aigarage-logo-horizontal-on-light.svg` |
| Over a photo or colored bg | any | `logo/aigarage-logo-mono-white.svg` |
| Single-color print (mono black) | white | `logo/aigarage-logo-mono-black.svg` |
| Favicon (browser tab) | — | `icon/aigarage-favicon.svg` |
| Favicon for light-mode browsers | — | `icon/aigarage-favicon-light.svg` |
| iOS app icon | — | `icon/aigarage-app-icon-rounded-brand.svg` |
| Android adaptive / app icon | — | `icon/aigarage-app-icon-square-brand.svg` |
| iOS dark-mode app icon variant | — | `icon/aigarage-app-icon-rounded-dark.svg` |
| SMS sender avatar (round) | — | `icon/aigarage-sms-avatar.svg` |
| Avatar on green tile | — | `icon/aigarage-sms-avatar-brand.svg` |
| In-product navbar / chip icon | dark UI | `mark/aigarage-mark-on-dark.svg` |
| Toolbar/nav icon on green pill | brand green | `mark/aigarage-mark-on-brand.svg` |
| Wordmark-only (footer, fineprint) | dark | `wordmark/aigarage-wordmark-on-dark.svg` |
| Wordmark-only | white | `wordmark/aigarage-wordmark-on-light.svg` |

If you're unsure, the **default everywhere** is `logo/aigarage-logo-horizontal-on-dark.svg`.

---

## Folder map

```
brand/
├── README.md               ← this file
├── manifest.json           ← machine-readable asset index (for Claude Code / scripts)
│
├── logo/                   ← full lockup (mark + wordmark) — use this 90% of the time
│   ├── aigarage-logo-horizontal-on-dark.svg
│   ├── aigarage-logo-horizontal-on-light.svg
│   ├── aigarage-logo-stacked-on-dark.svg
│   ├── aigarage-logo-stacked-on-light.svg
│   ├── aigarage-logo-mono-white.svg
│   └── aigarage-logo-mono-black.svg
│
├── mark/                   ← icon only (FrameG) — use in tight spaces
│   ├── aigarage-mark-on-dark.svg
│   ├── aigarage-mark-on-light.svg
│   ├── aigarage-mark-on-brand.svg
│   ├── aigarage-mark-mono-white.svg
│   └── aigarage-mark-mono-black.svg
│
├── wordmark/               ← type only — rare, mostly fineprint / footer
│   ├── aigarage-wordmark-on-dark.svg
│   ├── aigarage-wordmark-on-light.svg
│   ├── aigarage-wordmark-mono-white.svg
│   └── aigarage-wordmark-mono-black.svg
│
└── icon/                   ← favicons, app icons, SMS avatars
    ├── aigarage-favicon.svg
    ├── aigarage-favicon-light.svg
    ├── aigarage-app-icon-square-brand.svg
    ├── aigarage-app-icon-rounded-brand.svg
    ├── aigarage-app-icon-rounded-dark.svg
    ├── aigarage-sms-avatar.svg
    └── aigarage-sms-avatar-brand.svg
```

---

## Filename grammar

```
aigarage-{kind}-{variant}-{theme}.svg
```

- `kind` — `logo` (full lockup) · `mark` (icon only) · `wordmark` (type only) · `favicon` · `app-icon` · `sms-avatar`
- `variant` — for `logo`: `horizontal` or `stacked`. For `app-icon`: `square` or `rounded`. Optional.
- `theme` — describes the **intended background**, not the mark color:
  - `on-dark`   — for `#0b0d11` / dark UIs (green G + white AI)
  - `on-light`  — for `#FFFFFF` / paper (dark G + dark AI)
  - `on-brand`  — for `#22c55e` green tiles (dark G + white AI)
  - `mono-white`, `mono-black` — single-color treatments for photos / one-color print
  - `brand`, `dark` — for icons, names the tile color

---

## Brand tokens

```css
--aig-green:     #22c55e;   /* primary */
--aig-ink:       #0b0d11;   /* dark UI / text */
--aig-paper:     #f5f4f0;   /* warm light surface */
--aig-white:     #ffffff;

--aig-font-display: "Space Grotesk", "Inter", system-ui, -apple-system, sans-serif;
--aig-font-mono:    "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
```

Wordmark weight: **600** · letter-spacing: **-0.02em**.
Mark stroke weight: 12 (in the 100×100 viewBox).

---

## Clear-space + minimum size

- **Clear space**: reserve 1× of the mark's width on every side. Don't crop or overlap within that margin.
- **Minimum size**: 16px on screen, 8mm in print. Below this the tongue starts to collapse.

---

## Don'ts

- Don't recolor (use the supplied variants).
- Don't place the green-on-dark mark on a green or red background.
- Don't render the mark in white on a busy photo without a scrim.
- Don't squish the wordmark or change its tracking.
- Don't add a stroke, shadow, or gradient to the mark.

---

## Pre-built rasters (PNG + ICO)

Pre-rasterized PNGs for every common platform size live in `icon/png/`:

```
icon/png/
├── favicon-16.png … favicon-512.png        ← browser tabs (green tile)
├── apple-touch-icon.png  (180×180)         ← iOS home screen
├── apple-touch-icon-152.png / -167.png     ← legacy iPad sizes
├── apple-app-store-1024.png                ← App Store / OG share
├── android-chrome-{48..512}.png            ← Android adaptive
└── sms-avatar-{256,512}.png                ← round avatar
```

Plus `icon/favicon.ico` (multi-resolution: 16/32/48) for legacy IE/Edge.

If you need a size that's not pre-baked, rasterize from the SVG:

```bash
rsvg-convert -w 1024 brand/icon/aigarage-favicon.svg > out.png
# or:  npx svgexport brand/icon/aigarage-favicon.svg out.png 1024:1024
```

## Drop-in `<head>` snippet

Copy `brand/head-snippet.html` into your site `<head>` — wires up the SVG favicon, ICO fallback, apple-touch-icon, theme color, OG image, and links to the PWA manifest.

---

## React (lightweight import)

Each SVG is plain markup — import as a component or render as an `<img>`:

```tsx
// Vite / Next.js — SVGR
import AIGarageLogo from '~/brand/logo/aigarage-logo-horizontal-on-dark.svg?react';
<AIGarageLogo className="h-8" />

// Or plain <img>
<img src="/brand/logo/aigarage-logo-horizontal-on-dark.svg" alt="AIGarage" className="h-8" />
```
