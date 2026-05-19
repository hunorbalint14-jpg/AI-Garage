import { NextResponse, type NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { verifyShareAccess, recordView, type VerifyReason } from "@/lib/doc-shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map doc_key → path on disk (relative to the project root). The HTML files
// live OUTSIDE public/ so the only way to reach them is through this gate.
const DOC_MAP: Record<string, string> = {
  technical: "docs/internal/technical-doc.html",
  // Add more docs here:
  // runbook: "docs/internal/runbook.html",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const token = request.nextUrl.searchParams.get("t");

  const result = await verifyShareAccess(slug, token);
  if (!result.ok) {
    return gatePage(result.reason);
  }

  const relPath = DOC_MAP[result.share.doc_key];
  if (!relPath) return gatePage("not_found");

  let html: string;
  try {
    const abs = path.join(process.cwd(), relPath);
    html = await fs.readFile(abs, "utf-8");
  } catch (err) {
    console.error("[docs] failed to read", relPath, err);
    return gatePage("not_found");
  }

  // Fire-and-forget — no need to block the response on the view stamp.
  void recordView(result.share.id);

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store, must-revalidate",
      "Referrer-Policy": "no-referrer",
      // Allow inline scripts since the doc has its own; tighten if you remove them.
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Styled gate page for every refusal reason. Returns an appropriate HTTP code
// so monitoring / link-checkers can tell expired from invalid.
function gatePage(reason: VerifyReason): NextResponse {
  const table: Record<VerifyReason, { code: number; title: string; lede: string }> = {
    not_found: {
      code: 404,
      title: "Document not found",
      lede: "This link doesn't point to anything. It may have been mistyped, or the document has been moved.",
    },
    bad_token: {
      code: 401,
      title: "Invalid access token",
      lede: "The token in this link is missing or doesn't match. Ask whoever shared this with you for the original link.",
    },
    revoked: {
      code: 410,
      title: "Link revoked",
      lede: "This link has been revoked and can no longer be used. Ask whoever shared this with you to issue a new one.",
    },
    expired: {
      code: 410,
      title: "Link expired",
      lede: "This share link has reached its expiry date. Ask whoever shared this with you for a fresh link.",
    },
    exhausted: {
      code: 410,
      title: "View limit reached",
      lede: "This link was capped to a fixed number of views and has now been used up.",
    },
  };
  const { code, title, lede } = table[reason];

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — AI Garage</title>
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" href="/brand/icon/aigarage-favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/brand/icon/png/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="apple-touch-icon" href="/brand/icon/png/apple-touch-icon.png" sizes="180x180" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --aig-green: #22c55e;
      --aig-ink: #0b0d11;
      --aig-ink-3: #5b6270;
      --aig-rule: #cfd1c8;
      --aig-paper: #f5f4f0;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--aig-paper); color: var(--aig-ink); font-family: "Space Grotesk", system-ui, -apple-system, sans-serif; min-height: 100vh; }
    body { display: grid; place-items: center; padding: 32px; }
    .card { max-width: 520px; width: 100%; padding: 40px; border: 1px solid var(--aig-rule); border-radius: 8px; background: #fff; position: relative; }
    .card::before, .card::after { content: ""; position: absolute; width: 12px; height: 12px; border: 1px solid #5b6270; }
    .card::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
    .card::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
    .eyebrow { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--aig-ink-3); }
    .eyebrow .code { color: var(--aig-ink); }
    h1 { font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; font-weight: 600; margin: 12px 0 16px; }
    p { color: var(--aig-ink-3); line-height: 1.55; margin: 0 0 24px; }
    .brand { display: flex; align-items: center; gap: 10px; margin-top: 24px; padding-top: 20px; border-top: 1px dashed var(--aig-rule); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; color: var(--aig-ink-3); }
    .brand .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--aig-green); }
  </style>
</head>
<body>
  <div class="card">
    <img src="/brand/aigarage-logo-horizontal-on-light.svg" alt="AI Garage" style="display:block;height:28px;margin-bottom:24px" />
    <div class="eyebrow">Error · <span class="code">${code}</span></div>
    <h1>${title}</h1>
    <p>${lede}</p>
    <div class="brand"><span class="dot"></span> AI Garage · internal documentation</div>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: code,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  });
}
