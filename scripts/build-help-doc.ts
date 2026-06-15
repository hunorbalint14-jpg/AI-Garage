/*
 * Assemble the end-to-end user manual into a single self-contained HTML file
 * served through the doc-shares gate at /docs/userguide?t=…
 *
 *   npx tsx scripts/build-help-doc.ts   (or: npm run help:build)
 *
 * Reads the section manifest (docs/help/manual.content.ts) and the screenshots
 * captured by Playwright (docs/internal/help-images/<portal>/<id>.png), inlines
 * each PNG as a data: URI (CSP img-src allows data:), and writes
 * docs/internal/user-guide.html. Fonts and brand SVGs are referenced by absolute
 * path because the doc is served from the app origin (public/ is reachable).
 *
 * Missing screenshots degrade to a "pending" placeholder so the doc always
 * builds — capture and content can advance independently.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL, type Part, type Section } from "../docs/help/manual.content";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGES_DIR = path.join(ROOT, "docs/internal/help-images");
const OUT = path.join(ROOT, "docs/internal/user-guide.html");

function portalOf(part: Part): string {
  if (part.name === "Customer guide") return "customer";
  if (part.name === "Staff guide") return "staff";
  return "concept";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageTag(portal: string, section: Section): string {
  const file = path.join(IMAGES_DIR, portal, `${section.id}.png`);
  if (fs.existsSync(file)) {
    const b64 = fs.readFileSync(file).toString("base64");
    return `<img class="shot" loading="lazy" alt="${esc(section.title)} screenshot" src="data:image/png;base64,${b64}" />`;
  }
  return `<div class="shot shot--pending"><span>Screenshot pending</span><code>${portal}/${section.id}.png</code></div>`;
}

function notesBlock(section: Section): string {
  if (!section.notes?.length) return "";
  return `<div class="notes"><div class="notes__h">Good to know</div><ul>${section.notes
    .map((n) => `<li>${esc(n)}</li>`)
    .join("")}</ul></div>`;
}

function sectionBlock(portal: string, section: Section): string {
  const anchor = `${portal}-${section.id}`;

  // Concept page: no screenshot, full-width prose.
  if (section.noShot) {
    const paras = (section.prose ?? []).map((p) => `<p class="prose">${esc(p)}</p>`).join("\n");
    return `
  <section class="sec sec--concept" id="${anchor}">
    <header class="sec__head">
      <h3>${esc(section.title)}</h3>
      <p class="purpose">${esc(section.purpose)}</p>
    </header>
    <div class="sec__prose">
      ${paras}
      ${notesBlock(section)}
    </div>
  </section>`;
  }

  const steps = (section.steps ?? [])
    .map((s, i) => `<li><span class="badge">${i + 1}</span><p>${esc(s)}</p></li>`)
    .join("\n");
  return `
  <section class="sec" id="${anchor}">
    <header class="sec__head">
      <h3>${esc(section.title)}</h3>
      <p class="purpose">${esc(section.purpose)}</p>
    </header>
    <div class="sec__body">
      <figure class="sec__shot">${imageTag(portal, section)}</figure>
      <div class="sec__steps">
        <ol class="steps">${steps}</ol>
        ${notesBlock(section)}
      </div>
    </div>
  </section>`;
}

function tocPart(part: Part): string {
  const portal = portalOf(part);
  const items = part.sections
    .map((s) => `<li><a href="#${portal}-${s.id}">${esc(s.title)}</a></li>`)
    .join("");
  return `<div class="toc__group"><div class="toc__h">${esc(part.name)}</div><ul>${items}</ul></div>`;
}

function partBlock(part: Part): string {
  const portal = portalOf(part);
  const secs = part.sections.map((s) => sectionBlock(portal, s)).join("\n");
  return `
  <div class="part" id="part-${portal}">
    <div class="part__head">
      <h2>${esc(part.name)}</h2>
      <p>${esc(part.blurb)}</p>
    </div>
    ${secs}
  </div>`;
}

const generated = new Date().toLocaleDateString("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${esc(MANUAL.title)}</title>
  <link rel="icon" href="/brand/icon/aigarage-favicon.svg" type="image/svg+xml" />
  <style>
    @font-face { font-family:"Space Grotesk"; font-style:normal; font-weight:300 700; font-display:swap; src:url(/fonts/space-grotesk-latin.woff2) format("woff2"); }
    @font-face { font-family:"JetBrains Mono"; font-style:normal; font-weight:100 800; font-display:swap; src:url(/fonts/jetbrains-mono-latin.woff2) format("woff2"); }
    :root{
      --green:#22c55e; --ink:#0b0d11; --ink-2:#374151; --ink-3:#5b6270;
      --rule:#cfd1c8; --paper:#f5f4f0; --card:#ffffff;
    }
    *{box-sizing:border-box;}
    html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);
      font-family:"Space Grotesk",system-ui,-apple-system,sans-serif;line-height:1.55;}
    a{color:inherit;}
    code{font-family:"JetBrains Mono",ui-monospace,monospace;}
    .wrap{display:grid;grid-template-columns:260px 1fr;gap:0;max-width:1240px;margin:0 auto;}
    /* ---- sticky table of contents ---- */
    .toc{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;
      padding:28px 20px;border-right:1px solid var(--rule);background:var(--paper);}
    .toc__brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;}
    .toc__brand img{height:24px;}
    .toc__group{margin-bottom:20px;}
    .toc__h{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;
      text-transform:uppercase;color:var(--ink-3);margin-bottom:8px;}
    .toc ul{list-style:none;margin:0;padding:0;}
    .toc li{margin:0;}
    .toc a{display:block;padding:4px 8px;font-size:13px;color:var(--ink-2);
      border-radius:6px;text-decoration:none;}
    .toc a:hover{background:#fff;color:var(--ink);}
    /* ---- main column ---- */
    main{padding:40px 44px 96px;min-width:0;}
    .cover{border-bottom:1px solid var(--rule);padding-bottom:24px;margin-bottom:8px;}
    .eyebrow{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.16em;
      text-transform:uppercase;color:var(--ink-3);}
    .cover h1{font-size:34px;line-height:1.1;letter-spacing:-.02em;margin:10px 0 8px;}
    .cover p{color:var(--ink-3);margin:0;max-width:60ch;}
    .cover .meta{margin-top:14px;font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-3);}
    .part__head{margin:48px 0 8px;padding-top:8px;}
    .part__head h2{font-size:24px;letter-spacing:-.01em;margin:0;}
    .part__head p{color:var(--ink-3);margin:4px 0 0;}
    /* ---- a section card ---- */
    .sec{background:var(--card);border:1px solid var(--rule);border-radius:10px;
      padding:22px 24px;margin:20px 0;position:relative;}
    .sec__head h3{font-size:18px;margin:0;}
    .sec__head .purpose{color:var(--ink-3);margin:4px 0 0;font-size:14px;}
    .sec__body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);
      gap:24px;margin-top:16px;align-items:start;}
    .sec--concept{border-left:3px solid var(--ink);}
    .sec__prose{margin-top:14px;}
    .sec__prose .prose{margin:0 0 12px;font-size:14.5px;line-height:1.6;color:var(--ink-2);max-width:82ch;}
    .sec--concept .notes{max-width:82ch;}
    .sec__shot{margin:0;}
    .shot{width:100%;height:auto;display:block;border:1px solid var(--rule);
      border-radius:8px;background:#fff;}
    .shot--pending{aspect-ratio:16/10;display:flex;flex-direction:column;gap:8px;
      align-items:center;justify-content:center;color:var(--ink-3);
      background:repeating-linear-gradient(45deg,#fbfbf9,#fbfbf9 10px,#f1f1ec 10px,#f1f1ec 20px);}
    .shot--pending code{font-size:11px;}
    .steps{list-style:none;margin:0;padding:0;counter-reset:step;}
    .steps li{display:flex;gap:12px;align-items:flex-start;margin:0 0 14px;}
    .steps p{margin:0;font-size:14px;color:var(--ink-2);}
    .badge{flex:0 0 auto;width:22px;height:22px;border-radius:999px;background:var(--ink);
      color:#fff;font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;
      display:grid;place-items:center;margin-top:1px;}
    .notes{margin-top:8px;border-left:3px solid var(--green);background:#f3faf4;
      border-radius:0 8px 8px 0;padding:10px 14px;}
    .notes__h{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;
      text-transform:uppercase;color:#15803d;margin-bottom:4px;}
    .notes ul{margin:0;padding-left:18px;}
    .notes li{font-size:13px;color:var(--ink-2);margin-bottom:4px;}
    footer{margin-top:56px;padding-top:20px;border-top:1px dashed var(--rule);
      font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-3);
      display:flex;align-items:center;gap:10px;}
    footer .dot{width:8px;height:8px;border-radius:999px;background:var(--green);}
    @media (max-width:900px){
      .wrap{grid-template-columns:1fr;}
      .toc{position:static;height:auto;border-right:0;border-bottom:1px solid var(--rule);}
      .sec__body{grid-template-columns:1fr;}
      main{padding:28px 20px 64px;}
    }
  </style>
</head>
<body>
  <div class="wrap">
    <nav class="toc">
      <div class="toc__brand">
        <img src="/brand/aigarage-logo-horizontal-on-light.svg" alt="AI Garage" />
      </div>
      ${MANUAL.parts.map(tocPart).join("\n")}
    </nav>
    <main>
      <div class="cover">
        <div class="eyebrow">User manual</div>
        <h1>${esc(MANUAL.title)}</h1>
        <p>${esc(MANUAL.subtitle)}</p>
        <div class="meta">Generated ${generated}</div>
      </div>
      ${MANUAL.parts.map(partBlock).join("\n")}
      <footer><span class="dot"></span> AI Garage · user documentation</footer>
    </main>
  </div>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, "utf-8");

const total = MANUAL.parts.reduce((n, p) => n + p.sections.length, 0);
let shotTotal = 0;
let withShots = 0;
for (const part of MANUAL.parts) {
  const portal = portalOf(part);
  for (const s of part.sections) {
    if (s.noShot) continue;
    shotTotal++;
    if (fs.existsSync(path.join(IMAGES_DIR, portal, `${s.id}.png`))) withShots++;
  }
}
const concepts = total - shotTotal;
console.log(
  `[help] wrote ${path.relative(ROOT, OUT)} — ${total} sections (${concepts} concept, ${shotTotal} screenshot: ${withShots} present, ${shotTotal - withShots} pending).`,
);
