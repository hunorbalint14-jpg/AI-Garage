// Next.js client instrumentation (Next 15.3+). Runs after the document loads,
// before React hydration — ideal for error tracking. Uses the public DSN so it
// can reach the browser; dormant until NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // Error tracking only by default. Session Replay is off until explicitly
  // enabled (privacy: this app shows customer PII).
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

// Adds navigation breadcrumbs / ties client transitions to traces.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
