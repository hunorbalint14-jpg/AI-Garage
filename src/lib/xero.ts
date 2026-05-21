import { XeroClient } from "xero-node";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicOrigin } from "@/lib/stripe";
import { decrypt, encrypt } from "@/lib/encryption";

// OAuth scopes — granular set (Xero migrated away from broad scopes in
// March 2026; apps created after that date only have granular access).
// "offline_access" required for refresh tokens.
//
// What each scope unlocks for us:
//   accounting.contacts          → create Xero Contact for a customer
//   accounting.invoices          → create ACCREC invoices
//   accounting.payments          → record payments against invoices
//   accounting.banktransactions  → post Stripe payouts as bank transactions
//   accounting.settings.read     → read Accounts (find BANK account) — this
//                                  scope is NOT deprecated and survives the
//                                  March 2026 granular migration unchanged.
export const XERO_SCOPES = [
  "offline_access",
  "accounting.contacts",
  "accounting.invoices",
  "accounting.payments",
  "accounting.banktransactions",
  "accounting.settings.read",
];

function clientId(): string {
  return process.env.XERO_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.XERO_CLIENT_SECRET ?? "";
}

export function xeroRedirectUri(): string {
  return `${publicOrigin()}/api/xero/connect/callback`;
}

// New XeroClient per call — the SDK is stateful, so we don't share an
// instance across requests. The `state` arg is the value xero-node will
// expect to see echoed back on the OAuth callback. Begin uses the default;
// the callback must pass the actual state from the URL so xero-node's
// internal state-mismatch check passes (it compares URL state ↔ this).
export function makeXeroClient(state: string = "ai-garage"): XeroClient {
  return new XeroClient({
    clientId: clientId(),
    clientSecret: clientSecret(),
    redirectUris: [xeroRedirectUri()],
    scopes: XERO_SCOPES,
    state,
    httpTimeout: 30_000,
  });
}

type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO
  tenantId: string;
};

// Hydrate a XeroClient instance from the tokens stored on the
// organization, refreshing the access token if it expires within 60s.
// Returns null if the org isn't connected to Xero.
export async function getXeroClientForOrg(orgId: string): Promise<{
  client: XeroClient;
  tenantId: string;
} | null> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select(
      "id, xero_tenant_id, xero_access_token, xero_refresh_token, xero_token_expires_at",
    )
    .eq("id", orgId)
    .maybeSingle();

  if (!org?.xero_tenant_id || !org.xero_access_token || !org.xero_refresh_token) {
    return null;
  }

  const tokens: StoredTokens = {
    accessToken: decrypt(org.xero_access_token as string),
    refreshToken: decrypt(org.xero_refresh_token as string),
    expiresAt: org.xero_token_expires_at as string,
    tenantId: org.xero_tenant_id as string,
  };

  const client = makeXeroClient();

  // Refresh if access token has already expired or is within 60s of expiry.
  // refreshWithRefreshToken() is the low-level path — it doesn't need
  // client.initialize() (which makes a discovery call to Xero); it just
  // exchanges the refresh_token for a new token set directly. The old
  // path (setTokenSet + refreshToken()) blew up with
  //   TypeError: Cannot read properties of undefined (reading 'refresh')
  // because the internal openid-client wasn't initialised.
  const expiresInMs = new Date(tokens.expiresAt).getTime() - Date.now();
  let activeAccessToken = tokens.accessToken;
  let activeRefreshToken = tokens.refreshToken;
  let activeExpiresAt = tokens.expiresAt;

  if (expiresInMs < 60_000) {
    try {
      const refreshed = await client.refreshWithRefreshToken(
        clientId(),
        clientSecret(),
        tokens.refreshToken,
      );
      activeAccessToken = refreshed.access_token ?? activeAccessToken;
      activeRefreshToken = refreshed.refresh_token ?? activeRefreshToken;
      activeExpiresAt = new Date(
        (refreshed.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000,
      ).toISOString();

      await admin
        .from("organizations")
        .update({
          xero_access_token: encrypt(activeAccessToken),
          xero_refresh_token: encrypt(activeRefreshToken),
          xero_token_expires_at: activeExpiresAt,
        })
        .eq("id", orgId);
    } catch (err) {
      console.error("[xero] token refresh failed", err);
      return null;
    }
  }

  client.setTokenSet({
    access_token: activeAccessToken,
    refresh_token: activeRefreshToken,
    expires_at: Math.floor(new Date(activeExpiresAt).getTime() / 1000),
    token_type: "Bearer",
    scope: XERO_SCOPES.join(" "),
  });

  return { client, tenantId: tokens.tenantId };
}
