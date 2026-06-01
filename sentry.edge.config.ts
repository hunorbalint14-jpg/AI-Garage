// Sentry init for the Edge runtime (proxy.ts / middleware, edge route handlers).
// Loaded by src/instrumentation.ts when NEXT_RUNTIME === "edge". Dormant until
// SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  sendDefaultPii: false,
});
