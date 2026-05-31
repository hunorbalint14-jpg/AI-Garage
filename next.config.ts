import type { NextConfig } from "next";

// Starter CSP shipped in Report-Only mode (Phase 1) so violations are logged
// without breaking Next inline scripts, Stripe.js, or Supabase. Tune against
// reports, then promote to an enforced `Content-Security-Policy` in Phase 4.
// Violations POST here so we can review real traffic before flipping to an
// enforced policy. `report-to` (Reporting API) + `report-uri` (legacy) cover
// both browser generations.
const CSP_REPORT_ENDPOINT = "/api/csp-report";

// The Vercel Live feedback/comments toolbar is injected on PREVIEW deployments
// only. It loads a script + iframe from vercel.live and opens a Pusher
// websocket for real-time comments. Allow those sources on preview builds so
// the toolbar works (and stops spamming CSP reports); production stays tight —
// it never loads vercel.live.
const IS_PREVIEW = process.env.VERCEL_ENV === "preview";
const LIVE = "https://vercel.live";
const LIVE_PUSHER = "wss://ws-us3.pusher.com https://sockjs-us3.pusher.com";
const live = (extra: string) => (IS_PREVIEW ? ` ${extra}` : "");

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://js.stripe.com${live(LIVE)}`,
  `style-src 'self' 'unsafe-inline'${live(LIVE)}`,
  "img-src 'self' data: blob: https:",
  // Quote/DVI videos stream from Supabase Storage signed URLs via <video>.
  "media-src 'self' blob: https://*.supabase.co",
  `font-src 'self' data:${live(`${LIVE} https://assets.vercel.com`)}`,
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com${live(`${LIVE} ${LIVE_PUSHER}`)}`,
  `frame-src https://js.stripe.com https://hooks.stripe.com${live(LIVE)}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-to csp-endpoint",
  `report-uri ${CSP_REPORT_ENDPOINT}`,
].join("; ");

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Names the `csp-endpoint` group referenced by the CSP `report-to` directive.
  { key: "Reporting-Endpoints", value: `csp-endpoint="${CSP_REPORT_ENDPOINT}"` },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  // Tenant subdomains hit the dev server with a non-localhost Host header,
  // so Next.js' default HMR cross-origin block trips. Allowlist localtest.me
  // and any subdomain for local dev.
  allowedDevOrigins: ["localtest.me", "*.localtest.me"],

  // Move the Next.js dev indicator out of bottom-left so it doesn't overlap
  // the staff sidebar's user info / sign-out button.
  devIndicators: {
    position: "bottom-right",
  },

  // Ensure docs/internal/*.html files ship with the deployed build —
  // they're read at runtime by /docs/[slug] but live outside Next's
  // default tracing roots.
  outputFileTracingIncludes: {
    "/docs/[slug]": ["./docs/internal/**"],
  },
};

export default nextConfig;
