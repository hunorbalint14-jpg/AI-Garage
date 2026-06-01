// Sentry init for the Node.js server runtime. Loaded by src/instrumentation.ts
// via register(). Dormant until SENTRY_DSN is set in the environment (same
// graceful pattern as the rate limiter) — `enabled: false` means zero network
// and effectively no overhead, so this is safe to ship before the DSN exists.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Error tracking only by default; turn on tracing later by setting a rate.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  // Don't capture request bodies / cookies / user IP by default — this is a
  // multi-tenant app with customer PII.
  sendDefaultPii: false,
});
