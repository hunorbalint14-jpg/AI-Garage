import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Enforced CSP, promoted from Report-Only after reviewing real prod traffic
// (Supabase media, Google fonts, and the Vercel Live toolbar were the only
// real violations — all resolved). It still reports violations via report-to
// (Reporting API) + report-uri (legacy) so we keep visibility on anything it
// now blocks.
//
// 'unsafe-inline' is intentionally retained for script-src/style-src for now —
// removing it via per-request nonces is the next hardening step (a nonce makes
// browsers ignore 'unsafe-inline', so it can't be added incrementally).
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

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://js.stripe.com${live(LIVE)}`,
  `style-src 'self' 'unsafe-inline'${live(LIVE)}`,
  "img-src 'self' data: blob: https:",
  // Quote/DVI videos stream from Supabase Storage signed URLs via <video>.
  "media-src 'self' blob: https://*.supabase.co",
  `font-src 'self' data:${live(`${LIVE} https://assets.vercel.com`)}`,
  // *.sentry.io: the browser Sentry SDK posts events to its ingest host.
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.sentry.io${live(`${LIVE} ${LIVE_PUSHER}`)}`,
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
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  // Tree-shake barrel imports from these icon/UI/chart packages so a route only
  // ships the components it actually uses (lucide-react in particular has 1000+
  // icons behind a single entrypoint).
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "@base-ui/react"],
  },

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

// Wrap with Sentry so server errors (onRequestError) reliably flush before the
// Vercel serverless function suspends. silent: true because source-map upload
// is skipped without SENTRY_AUTH_TOKEN — keeps the build log clean.
export default withSentryConfig(nextConfig, {
  silent: true,
});
