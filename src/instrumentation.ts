// Next.js server instrumentation hook (App Router, Next 16). register() runs
// once per server instance; it loads the runtime-appropriate Sentry config.
// onRequestError forwards server-side errors (Server Components, Route
// Handlers, Server Actions) to Sentry. All no-op until SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
