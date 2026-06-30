// Shared email design — one dark, branded shell every transactional email
// renders into, so reminders, confirmations, quotes, receipts etc. all look
// the same. Inline styles + table layout only (email clients strip <style>
// rules and @font-face web fonts), with web-safe fallbacks for the design's
// Space Grotesk / JetBrains Mono type.

export type EmailCta = { url: string; label: string };
export type EmailDetailRow = { label: string; value: string };

// Palette (dark "garage" aesthetic from the reference design).
const BG = "#0b0d11"; // page
const CARD = "#0f1216"; // card surface
const BORDER = "#1e2329";
const TEXT = "#e6e8eb";
const MUTED = "#9aa1ab";
const FAINT = "#6b7280";
export const EMAIL_TEXT = TEXT;
export const ACCENT_DEFAULT = "#22c55e";

const FONT_DISPLAY = "'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif";
const FONT_MONO = "'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

// Black or white text for legibility on a given accent background.
function onAccent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#0b0d11";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0b0d11" : "#ffffff";
}

// Accent CTA button (table-based for Outlook).
export function emailButton(cta: EmailCta, accent: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0"><tr><td style="border-radius:10px;background:${accent}">
    <a href="${escAttr(cta.url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;color:${onAccent(accent)};text-decoration:none;border-radius:10px">${esc(cta.label)} →</a>
  </td></tr></table>`;
}

// A label/value spec sheet (When / Where / Service …) — mono uppercase labels.
export function emailDetails(rows: EmailDetailRow[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (r, i) => `<tr>
      <td style="padding:12px 0;${i > 0 ? `border-top:1px solid ${BORDER};` : ""}font-family:${FONT_MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${FAINT};white-space:nowrap;vertical-align:top">${esc(r.label)}</td>
      <td style="padding:12px 0 12px 16px;${i > 0 ? `border-top:1px solid ${BORDER};` : ""}font-family:${FONT_DISPLAY};font-size:15px;color:${TEXT};text-align:right">${esc(r.value).replace(/\n/g, "<br>")}</td>
    </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 4px;border:1px solid ${BORDER};border-radius:12px;padding:4px 16px">${body}</table>`;
}

export type EmailStep = { title: string; detail?: string; cta?: EmailCta };

// Numbered getting-started checklist for the shell body: a circled accent
// number + title, with an optional muted detail line and inline action link.
export function emailSteps(steps: EmailStep[], accent: string): string {
  if (steps.length === 0) return "";
  const rows = steps
    .map((s, i) => {
      const detail = s.detail
        ? `<div style="margin:3px 0 0;font-family:${FONT_DISPLAY};font-size:14px;line-height:1.55;color:${MUTED}">${esc(s.detail)}</div>`
        : "";
      const link = s.cta
        ? `<div style="margin-top:6px"><a href="${escAttr(s.cta.url)}" style="font-family:${FONT_DISPLAY};font-size:14px;font-weight:600;color:${accent};text-decoration:underline">${esc(s.cta.label)} →</a></div>`
        : "";
      return `<tr>
      <td width="34" valign="top" style="padding:10px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="26" height="26" align="center" style="width:26px;height:26px;border-radius:999px;background:${accent};font-family:${FONT_MONO};font-size:13px;font-weight:700;color:${onAccent(accent)};text-align:center;line-height:26px">${i + 1}</td></tr></table>
      </td>
      <td valign="top" style="padding:10px 0 10px 12px">
        <div style="font-family:${FONT_DISPLAY};font-size:15px;font-weight:600;color:${TEXT}">${esc(s.title)}</div>
        ${detail}${link}
      </td>
    </tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 8px">${rows}</table>`;
}

// Turn a plain-text body (double-newline paragraphs) into themed <p> blocks.
export function paragraphsToHtml(text: string): string {
  return text
    .split("\n\n")
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-family:${FONT_DISPLAY};font-size:15px;line-height:1.65;color:${TEXT}">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

export type RenderEmailOpts = {
  /** Brand shown in the header (org/garage name, or "AI Garage" for platform). */
  brandName: string;
  accentColor?: string;
  logoUrl?: string | null;
  /** Hidden inbox-preview line. */
  preheader?: string;
  /** Large display heading above the body. */
  heading?: string;
  /** Small accent status pill, e.g. "Confirmed". */
  badge?: string;
  /** Pre-rendered, already-escaped body HTML (use paragraphsToHtml). */
  bodyHtml: string;
  details?: EmailDetailRow[];
  cta?: EmailCta;
  /** Greyed line above the platform sign-off (e.g. address, opt-out). */
  footerNote?: string;
  publicOrigin: string;
};

export function renderEmail(opts: RenderEmailOpts): string {
  const accent = opts.accentColor && /^#[0-9a-f]{6}$/i.test(opts.accentColor) ? opts.accentColor : ACCENT_DEFAULT;
  const brand = esc(opts.brandName);

  // Brand mark: tenant logo in a light chip (legible on dark), else a wordmark.
  const brandMark = opts.logoUrl
    ? `<img src="${escAttr(opts.logoUrl)}" alt="${escAttr(opts.brandName)}" height="28" style="display:block;max-height:28px;width:auto;border:0">`
    : `<span style="font-family:${FONT_DISPLAY};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${TEXT}">${brand}</span>`;

  const badge = opts.badge
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr><td style="background:${accent};border-radius:999px;padding:5px 12px;font-family:${FONT_MONO};font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${onAccent(accent)}">${esc(opts.badge)}</td></tr></table>`
    : "";
  const heading = opts.heading
    ? `<h1 style="margin:0 0 14px;font-family:${FONT_DISPLAY};font-size:23px;line-height:1.25;font-weight:700;color:${TEXT}">${esc(opts.heading)}</h1>`
    : "";
  const details = opts.details ? emailDetails(opts.details) : "";
  const cta = opts.cta ? emailButton(opts.cta, accent) : "";
  const footerNote = opts.footerNote
    ? `<p style="margin:0 0 10px;font-family:${FONT_MONO};font-size:12px;line-height:1.6;color:${MUTED}">${esc(opts.footerNote).replace(/\n/g, "<br>")}</p>`
    : "";
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(opts.preheader)}</div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"></head>
<body style="margin:0;padding:0;background:${BG};-webkit-font-smoothing:antialiased">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG}">
  <tr><td align="center" style="padding:28px 16px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%">
      <tr><td style="background:${CARD};border:1px solid ${BORDER};border-radius:16px 16px 0 0;border-bottom:none;padding:22px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td style="vertical-align:middle">${brandMark}</td>
          <td style="vertical-align:middle;text-align:right"><span style="display:inline-block;width:28px;height:3px;border-radius:2px;background:${accent}"></span></td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${CARD};border-left:1px solid ${BORDER};border-right:1px solid ${BORDER};padding:8px 28px 28px">
        ${badge}${heading}${opts.bodyHtml}${details}${cta}
      </td></tr>
      <tr><td style="background:${CARD};border:1px solid ${BORDER};border-top:1px solid ${BORDER};border-radius:0 0 16px 16px;padding:20px 28px">
        ${footerNote}<p style="margin:0;font-family:${FONT_MONO};font-size:11px;color:${FAINT}">Sent via AI Garage · <a href="${escAttr(opts.publicOrigin)}" style="color:${FAINT};text-decoration:underline">ai-garage.co.uk</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}
