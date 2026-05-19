import { XeroClient } from "xero-node";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicOrigin } from "@/lib/stripe";

// OAuth scopes for invoice + payment push and basic contact creation.
// "offline_access" required for refresh tokens.
export const XERO_SCOPES = [
  "offline_access",
  "accounting.transactions",
  "accounting.contacts",
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
// instance across requests.
export function makeXeroClient(): XeroClient {
  return new XeroClient({
    clientId: clientId(),
    clientSecret: clientSecret(),
    redirectUris: [xeroRedirectUri()],
    scopes: XERO_SCOPES,
    state: "ai-garage",
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
    accessToken: org.xero_access_token as string,
    refreshToken: org.xero_refresh_token as string,
    expiresAt: org.xero_token_expires_at as string,
    tenantId: org.xero_tenant_id as string,
  };

  const client = makeXeroClient();
  await client.setTokenSet({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: Math.floor(new Date(tokens.expiresAt).getTime() / 1000),
    token_type: "Bearer",
    scope: XERO_SCOPES.join(" "),
  });

  // Refresh if expiring within the next minute.
  const expiresInMs = new Date(tokens.expiresAt).getTime() - Date.now();
  if (expiresInMs < 60_000) {
    try {
      const refreshed = await client.refreshToken();
      await admin
        .from("organizations")
        .update({
          xero_access_token: refreshed.access_token,
          xero_refresh_token: refreshed.refresh_token ?? tokens.refreshToken,
          xero_token_expires_at: new Date(
            (refreshed.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000,
          ).toISOString(),
        })
        .eq("id", orgId);
    } catch (err) {
      console.error("[xero] token refresh failed", err);
      return null;
    }
  }

  return { client, tenantId: tokens.tenantId };
}
