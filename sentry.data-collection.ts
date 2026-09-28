// What the Sentry SDK may collect — shared by the server, edge and browser
// configs (sentry.server.config.ts, sentry.edge.config.ts,
// src/instrumentation-client.ts).
//
// Sentry v11 replaced `sendDefaultPii` with `dataCollection`, and every
// category DEFAULTS TO ON: user info, cookies, headers, request/response
// bodies, query params, DB query data, gen-AI prompts/outputs, and local
// variables in stack frames. Before v11 this app ran with `sendDefaultPii:
// false` ("don't capture request bodies / cookies / user IP — this is a
// multi-tenant app with customer PII"), so dropping the removed option without
// replacing it would have silently started sending all of that. Here every
// category that can carry customer data is switched off explicitly.
//
// Two app-specific reasons beyond the obvious:
//   - urlQueryParams: the token-gated public links (booking confirmation,
//     inspection report, doc shares, …) carry their access token as `?t=…`.
//     Sentry's built-in scrubbing matches key SUBSTRINGS like "token"/"key";
//     a bare `t` contains none of them, so the token would ship as-is.
//   - genAI: customer messages and vehicle history go into Anthropic prompts.
//
// Typed Required<…> on purpose: if a future Sentry adds a new category (which
// would default to ON), typecheck fails here until someone decides about it.
import type * as Sentry from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>["dataCollection"]>;

export const SENTRY_DATA_COLLECTION: Required<DataCollection> = {
  userInfo: false,
  cookies: false,
  // Covers x-forwarded-for / x-real-ip (client IP) as well as auth headers.
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  // Source lines around a frame come from our own bundle, not customer data.
  frameContextLines: 5,
};
