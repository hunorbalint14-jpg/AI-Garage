import type { AccountingProviderId } from "./types";

// Tenant-level auth failures that surface on API PUSHES, not on token
// refresh. Every provider has a revocation mode the refresh-path health
// check (connection.ts) can never see because the token endpoint keeps
// answering:
//   - Xero: org disconnects the app (Connected Apps → Disconnect) — the
//     refresh succeeds but every API call returns 403 with body
//     { Title: "Forbidden", Detail: "AuthenticationUnsuccessful" }.
//   - QuickBooks: realm access revoked → data calls 401 with an
//     AUTHENTICATION fault ("AuthenticationFailed", "Token expired/
//     invalid", www-authenticate invalid_token).
//   - Sage: business access revoked → 401/403 Unauthorised/Forbidden on
//     data calls.
// logSync feeds push errors through isTenantAuthError; a match opens a
// reconnect episode (connection.ts markConnectionRevoked) so the banner
// shows and the daily cron emails the owner.

export type NormalizedSyncError = { status: number | null; text: string };

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

// Flatten any thrown shape into { status, text }. Our raw-REST providers
// (QuickBooks, Sage) throw Errors with the HTTP status embedded in the
// message; xero-node rejects a PLAIN OBJECT { response, body } — not an
// Error — so String(err) is "[object Object]" and the useful detail lives
// in response.statusCode + the JSON body.
export function normalizeSyncError(err: unknown): NormalizedSyncError {
  if (err == null) return { status: null, text: "" };
  if (typeof err === "string") return { status: null, text: err.slice(0, 2000) };

  const parts: string[] = [];
  let status: number | null = null;
  if (err instanceof Error && err.message) parts.push(err.message);
  if (typeof err === "object") {
    const e = err as {
      message?: unknown;
      statusCode?: unknown;
      status?: unknown;
      response?: { statusCode?: unknown; status?: unknown; body?: unknown; data?: unknown };
      body?: unknown;
    };
    if (!(err instanceof Error) && typeof e.message === "string") parts.push(e.message);
    for (const s of [e.statusCode, e.status, e.response?.statusCode, e.response?.status]) {
      if (typeof s === "number") {
        status = s;
        break;
      }
    }
    for (const b of [e.body, e.response?.body, e.response?.data]) {
      if (b == null) continue;
      parts.push(typeof b === "string" ? b : safeJson(b));
    }
  }
  if (parts.length === 0) parts.push(String(err));
  return { status, text: parts.join(" ").slice(0, 2000) };
}

// Human-readable message for the sync log — Error.message when there is
// one, otherwise the normalized text (so a xero-node rejection logs its
// body instead of "[object Object]").
export function syncErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  const { text } = normalizeSyncError(err);
  return text || String(err);
}

// One matcher per provider. Kept deliberately narrow — a false positive
// flags the connection broken and emails the owner; ordinary business
// validation failures (bad tax code, duplicate doc number) must not match.
const MATCHERS: Record<AccountingProviderId, (e: NormalizedSyncError) => boolean> = {
  // "AuthenticationUnsuccessful" is the Detail Xero returns only when the
  // app's connection to the tenant is gone; distinctive enough on its own
  // (the 403 status is often unavailable — xero-node rejection objects
  // don't always survive serialization into the message).
  xero: (e) => /authenticationunsuccessful/i.test(e.text),
  // A 401 on a QBO DATA call after a successful refresh is tenant-level
  // (expired/invalid/revoked token faults). Require both the status and
  // an auth-flavoured body so a "401" appearing in echoed line text can't
  // match alone. qboApi embeds the status in the wrapped Error message.
  quickbooks: (e) =>
    (e.status === 401 || /\b401\b/.test(e.text)) &&
    /invalid_token|authentication|token (expired|invalid|revoked)/i.test(e.text),
  // Sage business access revoked → 401 Unauthorised or 403 Forbidden on
  // data calls (sageApi embeds the status in the wrapped Error message).
  sage: (e) =>
    (e.status === 401 || e.status === 403 || /\b40[13]\b/.test(e.text)) &&
    /unauthori[sz]ed|forbidden|invalid.{0,3}(token|grant)|revoked|authentication/i.test(e.text),
};

export function isTenantAuthError(provider: string, err: unknown): boolean {
  const matcher = MATCHERS[provider as AccountingProviderId];
  return matcher ? matcher(normalizeSyncError(err)) : false;
}
