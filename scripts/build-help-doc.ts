/*
 * Assemble the end-to-end user manual into self-contained HTML files served
 * through the doc-shares gate (/docs/userguide?t=…) and the authenticated
 * staff route (/staff/manual).
 *
 *   npx tsx scripts/build-help-doc.ts   (or: npm run help:build)
 *
 * Reads the section manifest (docs/help/manual.content.ts), the screenshots
 * captured by Playwright (docs/internal/help-images/<portal>/<id>.png) and the
 * screen recordings (docs/internal/help-videos/<portal>/<id>.webm), inlines
 * everything as data: URIs, and writes:
 *
 *   docs/internal/user-guide.html          — full manual (all parts)
 *   docs/internal/user-guide-customer.html — concepts + customer guide only
 *
 * Missing screenshots degrade to a "pending" placeholder and missing videos
 * are simply skipped, so content and capture can advance independently.
 *
 * Extras rendered from the manifest: role badges, troubleshooting blocks,
 * per-part FAQs, interactive steppers (multi-state shots), embedded videos,
 * hand-built animated diagrams for the concept pages, and an in-page search
 * that filters sections live. All animation respects prefers-reduced-motion.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANUAL, type Part, type Section } from "../docs/help/manual.content";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGES_DIR = path.join(ROOT, "docs/internal/help-images");
const VIDEOS_DIR = path.join(ROOT, "docs/internal/help-videos");

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

function dataUri(file: string, mime: string): string | null {
  if (!fs.existsSync(file)) return null;
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function imageTag(portal: string, section: Section): string {
  const uri = dataUri(path.join(IMAGES_DIR, portal, `${section.id}.png`), "image/png");
  if (uri) {
    return `<img class="shot" loading="lazy" alt="${esc(section.title)} screenshot" src="${uri}" />`;
  }
  return `<div class="shot shot--pending"><span>Screenshot pending</span><code>${portal}/${section.id}.png</code></div>`;
}

function roleBadge(section: Section, portal: string): string {
  const label = section.roles ?? (portal === "staff" ? "All staff" : null);
  if (!label) return "";
  const gated = !!section.roles;
  return `<span class="role${gated ? " role--gated" : ""}" title="Who can see this page">${esc(label)}</span>`;
}

function notesBlock(section: Section): string {
  if (!section.notes?.length) return "";
  return `<div class="notes"><div class="notes__h">Good to know</div><ul>${section.notes
    .map((n) => `<li>${esc(n)}</li>`)
    .join("")}</ul></div>`;
}

function troubleshootBlock(section: Section): string {
  if (!section.troubleshooting?.length) return "";
  const rows = section.troubleshooting
    .map((t) => `<li><strong>${esc(t.problem)}</strong><span>${esc(t.fix)}</span></li>`)
    .join("");
  return `<div class="fix"><div class="fix__h">If something's off</div><ul>${rows}</ul></div>`;
}

function videoBlock(portal: string, section: Section): string {
  if (!section.video) return "";
  const uri = dataUri(path.join(VIDEOS_DIR, portal, `${section.id}.webm`), "video/webm");
  if (!uri) return "";
  return `
    <figure class="clip">
      <video controls muted playsinline preload="metadata" src="${uri}"></video>
      <figcaption>${esc(section.video.caption)}</figcaption>
    </figure>`;
}

let stepperSeq = 0;
function stepperBlock(portal: string, section: Section): string {
  if (!section.stepper?.length) return "";
  const frames = section.stepper
    .map((step, i) => {
      const uri = dataUri(path.join(IMAGES_DIR, portal, `${section.id}--${i + 1}.png`), "image/png");
      return uri ? { uri, caption: step.caption } : null;
    })
    .filter((f): f is { uri: string; caption: string } => !!f);
  if (frames.length < 2) return ""; // a one-frame stepper is just a screenshot
  const id = `stepper-${++stepperSeq}`;
  const imgs = frames
    .map(
      (f, i) =>
        `<img class="stepper__frame${i === 0 ? " is-active" : ""}" alt="Step ${i + 1}" src="${f.uri}" data-caption="${esc(f.caption)}" />`,
    )
    .join("");
  const dots = frames.map((_, i) => `<button class="stepper__dot${i === 0 ? " is-active" : ""}" data-i="${i}" aria-label="Step ${i + 1}"></button>`).join("");
  return `
    <div class="stepper" id="${id}">
      <div class="stepper__stage">${imgs}</div>
      <div class="stepper__bar">
        <button class="stepper__nav" data-dir="-1" aria-label="Previous step">←</button>
        <div class="stepper__dots">${dots}</div>
        <button class="stepper__nav" data-dir="1" aria-label="Next step">→</button>
      </div>
      <p class="stepper__caption">${esc(frames[0].caption)}</p>
    </div>`;
}

// ── Animated concept diagrams (pure CSS/HTML, zero external assets) ──────────

function diagramLifecycle(): string {
  const stages = ["Booking", "Job", "Quote", "Invoice", "Paid"];
  const nodes = stages
    .map(
      (s, i) => `
      <div class="dg-node" style="animation-delay:${i * 0.35}s">
        <span class="dg-node__label">${s}</span>
      </div>
      ${i < stages.length - 1 ? `<div class="dg-arrow" style="animation-delay:${i * 0.35 + 0.18}s"><span class="dg-arrow__pulse"></span></div>` : ""}`,
    )
    .join("");
  return `
  <div class="dg dg--lifecycle" role="img" aria-label="Pipeline: booking, job, optional quote, invoice, paid">
    <div class="dg__row">${nodes}</div>
    <div class="dg__foot">The quote step only appears when extra work is found — everything else happens on every visit.</div>
  </div>`;
}

function diagramFunding(): string {
  return `
  <div class="dg dg--funding" role="img" aria-label="Funding gate: payments accrue until the included service is covered">
    <div class="dg-fund__labels"><span>£0 paid in</span><span class="dg-fund__gate-label">funding gate</span><span>covered ✓</span></div>
    <div class="dg-fund__track">
      <div class="dg-fund__fill"></div>
      <div class="dg-fund__gate"></div>
    </div>
    <div class="dg__foot">Monthly payments fill the pot. The included MOT/service becomes free at booking only once the pot passes its price — before that, the member discount applies instead.</div>
  </div>`;
}

function diagramComms(): string {
  return `
  <div class="dg dg--comms" role="img" aria-label="Event messages come from the branch of the work; scheduled messages come from the customer's home branch">
    <div class="dg-comms__lane">
      <div class="dg-comms__from">Branch doing the work</div>
      <div class="dg-comms__line"><span class="dg-comms__dot"></span></div>
      <div class="dg-comms__to">Booking confirmations · quotes · invoices · receipts</div>
    </div>
    <div class="dg-comms__lane">
      <div class="dg-comms__from">Customer's home branch</div>
      <div class="dg-comms__line dg-comms__line--alt"><span class="dg-comms__dot" style="animation-delay:.9s"></span></div>
      <div class="dg-comms__to">MOT &amp; service reminders · campaigns</div>
    </div>
    <div class="dg__foot">Two kinds of message, two senders — so the customer always hears from the right branch, exactly once.</div>
  </div>`;
}

function diagramOrg(): string {
  return `
  <div class="dg dg--org" role="img" aria-label="Organisation contains branches; roles decide reach">
    <div class="dg-org__root" style="animation-delay:0s">Organisation<span>owner · admin · accountant see everything</span></div>
    <div class="dg-org__branches">
      <div class="dg-org__branch" style="animation-delay:.35s">Branch A<span>branch staff + permissions</span></div>
      <div class="dg-org__branch" style="animation-delay:.55s">Branch B<span>branch staff + permissions</span></div>
    </div>
    <div class="dg-org__customers" style="animation-delay:.85s">Customers — registered once, recognised at every branch</div>
  </div>`;
}

function diagramBlock(section: Section): string {
  switch (section.diagram) {
    case "lifecycle": return diagramLifecycle();
    case "funding": return diagramFunding();
    case "comms": return diagramComms();
    case "org": return diagramOrg();
    default: return "";
  }
}

// ── Section / part assembly ──────────────────────────────────────────────────

function sectionBlock(portal: string, section: Section): string {
  const anchor = `${portal}-${section.id}`;

  // Concept page: no screenshot, full-width prose (+ optional diagram).
  if (section.noShot) {
    const paras = (section.prose ?? []).map((p) => `<p class="prose">${esc(p)}</p>`).join("\n");
    return `
  <section class="sec sec--concept" id="${anchor}">
    <header class="sec__head">
      <h3>${esc(section.title)}</h3>
      <p class="purpose">${esc(section.purpose)}</p>
    </header>
    <div class="sec__prose">
      ${diagramBlock(section)}
      ${paras}
      ${notesBlock(section)}
      ${troubleshootBlock(section)}
    </div>
  </section>`;
  }

  const steps = (section.steps ?? [])
    .map((s, i) => `<li><span class="badge">${i + 1}</span><p>${esc(s)}</p></li>`)
    .join("\n");
  return `
  <section class="sec" id="${anchor}">
    <header class="sec__head">
      <h3>${esc(section.title)} ${roleBadge(section, portal)}</h3>
      <p class="purpose">${esc(section.purpose)}</p>
    </header>
    <div class="sec__body">
      <figure class="sec__shot">${imageTag(portal, section)}</figure>
      <div class="sec__steps">
        <ol class="steps">${steps}</ol>
        ${notesBlock(section)}
        ${troubleshootBlock(section)}
      </div>
    </div>
    ${stepperBlock(portal, section)}
    ${videoBlock(portal, section)}
  </section>`;
}

function faqBlock(part: Part): string {
  if (!part.faq?.length) return "";
  const items = part.faq
    .map(
      (f) => `
    <details class="faq__item">
      <summary>${esc(f.q)}</summary>
      <p>${esc(f.a)}</p>
    </details>`,
    )
    .join("");
  return `
  <section class="sec sec--faq" id="faq-${portalOf(part)}">
    <header class="sec__head"><h3>Common questions</h3></header>
    <div class="faq">${items}</div>
  </section>`;
}

function tocPart(part: Part): string {
  const portal = portalOf(part);
  const items = part.sections
    .map((s) => `<li><a href="#${portal}-${s.id}">${esc(s.title)}</a></li>`)
    .join("");
  const faqItem = part.faq?.length ? `<li><a href="#faq-${portal}">Common questions</a></li>` : "";
  return `<div class="toc__group"><div class="toc__h">${esc(part.name)}</div><ul>${items}${faqItem}</ul></div>`;
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
    ${faqBlock(part)}
  </div>`;
}

// ── Page shell ───────────────────────────────────────────────────────────────

const CSS = `
    @font-face { font-family:"Space Grotesk"; font-style:normal; font-weight:300 700; font-display:swap; src:url(/fonts/space-grotesk-latin.woff2) format("woff2"); }
    @font-face { font-family:"JetBrains Mono"; font-style:normal; font-weight:100 800; font-display:swap; src:url(/fonts/jetbrains-mono-latin.woff2) format("woff2"); }
    :root{
      --green:#22c55e; --ink:#0b0d11; --ink-2:#374151; --ink-3:#5b6270;
      --rule:#cfd1c8; --paper:#f5f4f0; --card:#ffffff; --amber:#b45309;
    }
    *{box-sizing:border-box;}
    html{scroll-behavior:smooth;}
    html,body{margin:0;padding:0;background:var(--paper);color:var(--ink);
      font-family:"Space Grotesk",system-ui,-apple-system,sans-serif;line-height:1.55;}
    a{color:inherit;}
    code{font-family:"JetBrains Mono",ui-monospace,monospace;}
    .wrap{display:grid;grid-template-columns:270px 1fr;gap:0;max-width:1280px;margin:0 auto;}
    /* ---- sticky table of contents ---- */
    .toc{position:sticky;top:0;align-self:start;height:100vh;overflow:auto;
      padding:28px 20px;border-right:1px solid var(--rule);background:var(--paper);}
    .toc__brand{display:flex;align-items:center;gap:10px;margin-bottom:18px;}
    .toc__brand img{height:24px;}
    .toc__group{margin-bottom:20px;}
    .toc__h{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;
      text-transform:uppercase;color:var(--ink-3);margin-bottom:8px;}
    .toc ul{list-style:none;margin:0;padding:0;}
    .toc li{margin:0;}
    .toc a{display:block;padding:4px 8px;font-size:13px;color:var(--ink-2);
      border-radius:6px;text-decoration:none;}
    .toc a:hover{background:#fff;color:var(--ink);}
    .toc li.is-hidden{display:none;}
    .toc__group.is-hidden{display:none;}
    /* ---- search ---- */
    .search{margin-bottom:18px;}
    .search input{width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:8px;
      font:inherit;font-size:13px;background:#fff;color:var(--ink);}
    .search input:focus{outline:2px solid var(--green);outline-offset:1px;border-color:transparent;}
    .search__meta{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--ink-3);
      margin-top:6px;min-height:14px;}
    mark{background:#fef08a;color:inherit;border-radius:2px;padding:0 1px;}
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
    .sec.is-hidden{display:none;}
    .part.is-hidden{display:none;}
    .sec__head h3{font-size:18px;margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    .sec__head .purpose{color:var(--ink-3);margin:4px 0 0;font-size:14px;}
    .role{font-family:"JetBrains Mono",monospace;font-size:9.5px;letter-spacing:.1em;
      text-transform:uppercase;border:1px solid var(--rule);border-radius:999px;
      padding:3px 9px;color:var(--ink-3);font-weight:400;}
    .role--gated{border-color:#f0d9b5;background:#fdf6e9;color:var(--amber);}
    .sec__body{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);
      gap:24px;margin-top:16px;align-items:start;}
    .sec--concept{border-left:3px solid var(--ink);}
    .sec__prose{margin-top:14px;}
    .sec__prose .prose{margin:0 0 12px;font-size:14.5px;line-height:1.6;color:var(--ink-2);max-width:82ch;}
    .sec--concept .notes,.sec--concept .fix{max-width:82ch;}
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
    .fix{margin-top:10px;border-left:3px solid var(--amber);background:#fdf6e9;
      border-radius:0 8px 8px 0;padding:10px 14px;}
    .fix__h{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.14em;
      text-transform:uppercase;color:var(--amber);margin-bottom:4px;}
    .fix ul{margin:0;padding-left:0;list-style:none;}
    .fix li{font-size:13px;color:var(--ink-2);margin-bottom:8px;}
    .fix li strong{display:block;font-weight:600;color:var(--ink);}
    .fix li span{display:block;}
    /* ---- FAQ ---- */
    .sec--faq{border-left:3px solid var(--ink-3);}
    .faq{margin-top:12px;}
    .faq__item{border-bottom:1px dashed var(--rule);padding:2px 0;}
    .faq__item summary{cursor:pointer;font-size:14.5px;font-weight:600;padding:10px 4px;
      list-style-position:outside;}
    .faq__item summary:hover{color:#000;}
    .faq__item p{margin:0 4px 12px;font-size:14px;color:var(--ink-2);max-width:80ch;}
    /* ---- video clip ---- */
    .clip{margin:18px 0 4px;}
    .clip video{width:100%;max-width:840px;display:block;border:1px solid var(--rule);
      border-radius:8px;background:#000;}
    .clip figcaption{font-family:"JetBrains Mono",monospace;font-size:10.5px;
      letter-spacing:.06em;color:var(--ink-3);margin-top:8px;}
    /* ---- stepper ---- */
    .stepper{margin:18px 0 4px;max-width:840px;}
    .stepper__stage{position:relative;border:1px solid var(--rule);border-radius:8px;
      overflow:hidden;background:#fff;}
    .stepper__frame{width:100%;height:auto;display:none;}
    .stepper__frame.is-active{display:block;}
    .stepper__bar{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:10px;}
    .stepper__nav{border:1px solid var(--rule);background:#fff;border-radius:999px;width:30px;height:30px;
      cursor:pointer;font:inherit;color:var(--ink-2);}
    .stepper__nav:hover{background:var(--ink);color:#fff;}
    .stepper__dots{display:flex;gap:8px;}
    .stepper__dot{width:9px;height:9px;border-radius:999px;border:1px solid var(--ink-3);
      background:transparent;cursor:pointer;padding:0;}
    .stepper__dot.is-active{background:var(--ink);border-color:var(--ink);}
    .stepper__caption{text-align:center;font-size:13.5px;color:var(--ink-2);margin:8px 0 0;min-height:20px;}
    /* ---- diagrams ---- */
    .dg{border:1px dashed var(--rule);border-radius:10px;background:#fbfbf8;
      padding:20px 22px;margin:4px 0 18px;}
    .dg__foot{font-size:12.5px;color:var(--ink-3);margin-top:14px;font-family:"JetBrains Mono",monospace;}
    .dg__row{display:flex;align-items:center;gap:0;flex-wrap:wrap;}
    .dg-node{border:1px solid var(--ink);border-radius:8px;background:#fff;padding:10px 16px;
      font-weight:600;font-size:14px;opacity:0;animation:dg-in .5s ease-out forwards;}
    .dg-arrow{width:46px;height:2px;background:var(--rule);position:relative;margin:0 4px;
      opacity:0;animation:dg-in .4s ease-out forwards;}
    .dg-arrow::after{content:"";position:absolute;right:-1px;top:-3px;border:4px solid transparent;
      border-left-color:var(--ink-3);}
    .dg-arrow__pulse{position:absolute;left:0;top:-2px;width:6px;height:6px;border-radius:999px;
      background:var(--green);animation:dg-travel 2.6s linear infinite;}
    @keyframes dg-in{to{opacity:1;}}
    @keyframes dg-travel{0%{left:0;opacity:0;}12%{opacity:1;}88%{opacity:1;}100%{left:calc(100% - 6px);opacity:0;}}
    .dg-fund__labels{display:flex;justify-content:space-between;font-family:"JetBrains Mono",monospace;
      font-size:10.5px;color:var(--ink-3);margin-bottom:8px;}
    .dg-fund__gate-label{color:var(--amber);}
    .dg-fund__track{position:relative;height:16px;border:1px solid var(--rule);border-radius:999px;
      background:#fff;overflow:hidden;}
    .dg-fund__fill{position:absolute;inset:0;width:0;background:linear-gradient(90deg,#bbf7d0,var(--green));
      animation:dg-fill 4.5s ease-in-out infinite;}
    .dg-fund__gate{position:absolute;top:-4px;bottom:-4px;left:62%;width:2px;background:var(--amber);}
    @keyframes dg-fill{0%{width:0;}55%{width:62%;}75%{width:78%;}100%{width:78%;}}
    .dg-comms__lane{display:grid;grid-template-columns:180px 1fr 1.4fr;align-items:center;gap:12px;
      margin:10px 0;}
    .dg-comms__from{font-weight:600;font-size:13.5px;background:#fff;border:1px solid var(--ink);
      border-radius:8px;padding:8px 12px;text-align:center;}
    .dg-comms__line{position:relative;height:2px;background:var(--rule);}
    .dg-comms__dot{position:absolute;top:-3px;left:0;width:8px;height:8px;border-radius:999px;
      background:var(--green);animation:dg-travel 3s linear infinite;}
    .dg-comms__line--alt .dg-comms__dot{background:var(--amber);}
    .dg-comms__to{font-size:13px;color:var(--ink-2);}
    .dg-org__root{border:1px solid var(--ink);border-radius:8px;background:#fff;padding:10px 16px;
      font-weight:600;text-align:center;max-width:420px;margin:0 auto;opacity:0;animation:dg-in .5s ease-out forwards;}
    .dg-org__root span,.dg-org__branch span{display:block;font-weight:400;font-size:11.5px;color:var(--ink-3);margin-top:2px;}
    .dg-org__branches{display:flex;gap:16px;justify-content:center;margin:16px 0;}
    .dg-org__branch{border:1px solid var(--rule);border-radius:8px;background:#fff;padding:10px 16px;
      font-weight:600;text-align:center;opacity:0;animation:dg-in .5s ease-out forwards;}
    .dg-org__customers{text-align:center;font-size:13px;color:var(--ink-2);border-top:1px dashed var(--rule);
      padding-top:12px;opacity:0;animation:dg-in .5s ease-out forwards;}
    @media (prefers-reduced-motion: reduce){
      .dg-node,.dg-arrow,.dg-org__root,.dg-org__branch,.dg-org__customers{animation:none;opacity:1;}
      .dg-arrow__pulse,.dg-comms__dot{animation:none;}
      .dg-fund__fill{animation:none;width:78%;}
      html{scroll-behavior:auto;}
    }
    footer{margin-top:56px;padding-top:20px;border-top:1px dashed var(--rule);
      font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--ink-3);
      display:flex;align-items:center;gap:10px;}
    footer .dot{width:8px;height:8px;border-radius:999px;background:var(--green);}
    @media (max-width:900px){
      .wrap{grid-template-columns:1fr;}
      .toc{position:static;height:auto;border-right:0;border-bottom:1px solid var(--rule);}
      .sec__body{grid-template-columns:1fr;}
      main{padding:28px 20px 64px;}
      .dg-comms__lane{grid-template-columns:1fr;gap:6px;}
    }
`;

const JS = `
  // In-page search: filters sections (and their TOC links) by text match.
  (function () {
    var input = document.getElementById("search-input");
    var meta = document.getElementById("search-meta");
    if (!input) return;
    var secs = Array.prototype.slice.call(document.querySelectorAll("section.sec"));
    var index = secs.map(function (sec) {
      return { el: sec, text: (sec.textContent || "").toLowerCase(), id: sec.id };
    });
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[href^='#']"));
    function apply() {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      index.forEach(function (item) {
        var hit = !q || item.text.indexOf(q) !== -1;
        item.el.classList.toggle("is-hidden", !hit);
        if (hit) shown++;
      });
      tocLinks.forEach(function (a) {
        var id = a.getAttribute("href").slice(1);
        var target = document.getElementById(id);
        var hidden = target ? target.classList.contains("is-hidden") : false;
        a.parentElement.classList.toggle("is-hidden", hidden);
      });
      document.querySelectorAll(".toc__group").forEach(function (g) {
        var any = g.querySelectorAll("li:not(.is-hidden)").length > 0;
        g.classList.toggle("is-hidden", !any);
      });
      document.querySelectorAll(".part").forEach(function (p) {
        var any = p.querySelectorAll("section.sec:not(.is-hidden)").length > 0;
        p.classList.toggle("is-hidden", !any);
      });
      meta.textContent = q ? shown + " section" + (shown === 1 ? "" : "s") + " match" : "";
    }
    input.addEventListener("input", apply);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.value = ""; apply(); input.blur(); }
    });
  })();

  // Steppers: click-through frames with dots + captions.
  document.querySelectorAll(".stepper").forEach(function (root) {
    var frames = root.querySelectorAll(".stepper__frame");
    var dots = root.querySelectorAll(".stepper__dot");
    var caption = root.querySelector(".stepper__caption");
    var i = 0;
    function go(n) {
      i = (n + frames.length) % frames.length;
      frames.forEach(function (f, j) { f.classList.toggle("is-active", j === i); });
      dots.forEach(function (d, j) { d.classList.toggle("is-active", j === i); });
      if (caption) caption.textContent = frames[i].getAttribute("data-caption") || "";
    }
    root.querySelectorAll(".stepper__nav").forEach(function (btn) {
      btn.addEventListener("click", function () { go(i + parseInt(btn.getAttribute("data-dir"), 10)); });
    });
    dots.forEach(function (d, j) { d.addEventListener("click", function () { go(j); }); });
  });
`;

function buildHtml(parts: Part[], title: string, subtitle: string): string {
  const generated = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${esc(title)}</title>
  <link rel="icon" href="/brand/icon/aigarage-favicon.svg" type="image/svg+xml" />
  <style>${CSS}</style>
</head>
<body>
  <div class="wrap">
    <nav class="toc">
      <div class="toc__brand">
        <img src="/brand/aigarage-logo-horizontal-on-light.svg" alt="AI Garage" />
      </div>
      <div class="search">
        <input id="search-input" type="search" placeholder="Search the manual…" aria-label="Search the manual" />
        <div id="search-meta" class="search__meta"></div>
      </div>
      ${parts.map(tocPart).join("\n")}
    </nav>
    <main>
      <div class="cover">
        <div class="eyebrow">User manual</div>
        <h1>${esc(title)}</h1>
        <p>${esc(subtitle)}</p>
        <div class="meta">Generated ${generated}</div>
      </div>
      ${parts.map(partBlock).join("\n")}
      <footer><span class="dot"></span> AI Garage · user documentation</footer>
    </main>
  </div>
  <script>${JS}</script>
</body>
</html>`;
}

// ── Emit both builds ─────────────────────────────────────────────────────────

type Build = { file: string; parts: Part[]; title: string; subtitle: string };

const BUILDS: Build[] = [
  {
    file: "docs/internal/user-guide.html",
    parts: MANUAL.parts,
    title: MANUAL.title,
    subtitle: MANUAL.subtitle,
  },
  {
    file: "docs/internal/user-guide-customer.html",
    parts: MANUAL.parts.filter((p) => p.name !== "Staff guide"),
    title: "AI Garage — Customer Guide",
    subtitle: "How to use your garage's online portal: bookings, quotes, invoices and plans.",
  },
];

for (const build of BUILDS) {
  stepperSeq = 0;
  const out = path.join(ROOT, build.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buildHtml(build.parts, build.title, build.subtitle), "utf-8");

  let total = 0, shotTotal = 0, withShots = 0, videos = 0;
  for (const part of build.parts) {
    const portal = portalOf(part);
    for (const s of part.sections) {
      total++;
      if (s.noShot) continue;
      shotTotal++;
      if (fs.existsSync(path.join(IMAGES_DIR, portal, `${s.id}.png`))) withShots++;
      if (s.video && fs.existsSync(path.join(VIDEOS_DIR, portal, `${s.id}.webm`))) videos++;
    }
  }
  const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
  console.log(
    `[help] wrote ${build.file} (${sizeMb} MB) — ${total} sections, shots ${withShots}/${shotTotal}, videos ${videos}.`,
  );
}
