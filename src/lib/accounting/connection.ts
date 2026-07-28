import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/encryption";
import { refreshXeroTokens, xeroProvider } from "./xero-provider";
import { refreshQuickBooksTokens, quickBooksProvider } from "./quickbooks-provider";
import { refreshSageTokens, sageProvider } from "./sage-provider";
import type {
  AccountingConnection,
  AccountingProvider,
  AccountingProviderId,
  RefreshedTokens,
} from "./types";

export const PROVIDERS: Record<AccountingProviderId, AccountingProvider> = {
  xero: xeroProvider,
  quickbooks: quickBooksProvider,
  sage: sageProvider,
};

const REFRESHERS: Record<AccountingProviderId, (refreshToken: string) => Promise<RefreshedTokens>> = {
  xero: refreshXeroTokens,
  quickbooks: refreshQuickBooksTokens,
  sage: refreshSageTokens,
};

type ConnectionRow = {
  organization_id: string;
  provider: AccountingProviderId;
  external_id: string;
  display_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  connected_at: string;
  needs_reconnect: boolean | null;
  last_refresh_error: string | null;
};

// Marker distinguishing a tenant-revoked episode (refresh keeps working
// but the provider 401/403s every API push — e.g. Xero Connected Apps
// disconnect) from a refresh-failure episode. A successful token refresh
// must NOT close a revoked episode; only a successful push does.
const REVOKED_EPISODE_PREFIX = "provider access revoked";

function isRevokedEpisode(lastRefreshError: string | null): boolean {
  return !!lastRefreshError?.startsWith(REVOKED_EPISODE_PREFIX);
}

// Load the org's accounting connection with decrypted tokens, refreshing
// the access token if it expires within 60s (rotated refresh tokens are
// persisted — QuickBooks rotates on every refresh). Returns null when the
// org isn't connected or the refresh fails; callers treat null as "not
// connected" and skip the sync silently.
export async function getAccountingConnection(
  orgId: string,
): Promise<AccountingConnection | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("accounting_connections")
    .select("organization_id, provider, external_id, display_name, access_token, refresh_token, token_expires_at, connected_at, needs_reconnect, last_refresh_error")
    .eq("organization_id", orgId)
    .maybeSingle();

  const row = data as ConnectionRow | null;
  if (!row?.access_token || !row.refresh_token || !(row.provider in PROVIDERS)) {
    return null;
  }

  let accessToken = decrypt(row.access_token);
  let refreshToken = decrypt(row.refresh_token);
  let expiresAt = row.token_expires_at;

  const expiresInMs = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0;
  if (expiresInMs < 60_000) {
    try {
      const refreshed = await REFRESHERS[row.provider](refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      expiresAt = refreshed.expiresAt;
      await admin
        .from("accounting_connections")
        .update({
          access_token: encrypt(accessToken),
          refresh_token: encrypt(refreshToken),
          token_expires_at: expiresAt,
          // A successful refresh ends a refresh-failure episode — but NOT
          // a revoked episode (that failure mode refreshes fine while every
          // push 403s; only a successful push closes it, via logSync).
          ...(row.needs_reconnect && !isRevokedEpisode(row.last_refresh_error)
            ? { needs_reconnect: false, last_refresh_error: null, last_refresh_error_at: null, reconnect_alerted_at: null }
            : {}),
        })
        .eq("organization_id", orgId);
    } catch (err) {
      // A dead refresh token severs the digital link — it used to do so
      // SILENTLY (no sync-log row, no banner; Sage refresh tokens die
      // after 31 days unused, QuickBooks after ~100). Record the failure
      // so the UI can demand a reconnect and the cron can alert the owner.
      console.error(`[accounting] ${row.provider} token refresh failed`, err);
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await admin
        .from("accounting_connections")
        .update({
          needs_reconnect: true,
          last_refresh_error: message,
          last_refresh_error_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId);
      if (!row.needs_reconnect) {
        // First failure of the episode → one visible sync-log row.
        await admin.from("accounting_sync_log").insert({
          organization_id: orgId,
          provider: row.provider,
          entity_type: "connection",
          status: "failed",
          error: `token refresh failed — reconnect required: ${message}`.slice(0, 500),
        });
      }
      return null;
    }
  }

  return {
    organizationId: row.organization_id,
    provider: row.provider,
    externalId: row.external_id,
    displayName: row.display_name,
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt,
    connectedAt: row.connected_at,
  };
}

// Open a reconnect episode from the PUSH error path — the provider
// rejected an API call at tenant level (access revoked provider-side)
// even though token refresh still works, so the refresh-path detection
// above never fires. Same episode semantics as the refresh path: one
// 'connection' sync-log row per episode, reconnect_alerted_at reset so
// the daily accounting-backfill cron emails the owner once.
export async function markConnectionRevoked(args: {
  organizationId: string;
  provider: string;
  detail: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("accounting_connections")
    .select("provider, needs_reconnect")
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  const row = data as { provider: string; needs_reconnect: boolean | null } | null;
  // Gone or already reconnected to a different provider — the error we
  // caught belongs to a dead connection; nothing to flag.
  if (!row || row.provider !== args.provider) return;
  // Episode already open (revoked or refresh-failure) — keep the single
  // sync-log row + single owner email per episode.
  if (row.needs_reconnect) return;

  console.error(`[accounting] ${args.provider} access revoked at tenant level`, {
    organizationId: args.organizationId,
    detail: args.detail,
  });
  await admin
    .from("accounting_connections")
    .update({
      needs_reconnect: true,
      last_refresh_error: `${REVOKED_EPISODE_PREFIX} — pushes rejected after token refresh: ${args.detail}`.slice(0, 500),
      last_refresh_error_at: new Date().toISOString(),
      reconnect_alerted_at: null,
    })
    .eq("organization_id", args.organizationId);
  await admin.from("accounting_sync_log").insert({
    organization_id: args.organizationId,
    provider: args.provider,
    entity_type: "connection",
    status: "failed",
    error: `${args.provider} access revoked — reconnect required: ${args.detail}`.slice(0, 500),
  });
}

// A successful push proves the link end-to-end — close any open reconnect
// episode (revoked or refresh-failure). Conditional update so the common
// healthy-path push costs one no-op statement, no read.
export async function clearReconnectEpisode(orgId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("accounting_connections")
    .update({
      needs_reconnect: false,
      last_refresh_error: null,
      last_refresh_error_at: null,
      reconnect_alerted_at: null,
    })
    .eq("organization_id", orgId)
    .eq("needs_reconnect", true);
  if (error) console.error("[accounting] clearing reconnect episode failed", error.message);
}

// Persist a fresh OAuth connection. If the org was previously connected
// to a DIFFERENT provider (or a different company on the same provider),
// the stored external ids on invoices/customers/credit notes belong to
// the old ledger and would corrupt pushes against the new one — wipe
// them. Reference-tag dedupe rebuilds mappings if the org ever
// reconnects the original company.
//
// Reconnecting the SAME provider + company (the token-expiry recovery
// flow) keeps the existing connected_at: it anchors the books-health
// window and the backfill sweep, so resetting it would silently orphan
// everything issued during the outage.
export async function saveAccountingConnection(args: {
  organizationId: string;
  provider: AccountingProviderId;
  externalId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string;
  connectedBy: string | null;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("accounting_connections")
    .select("provider, external_id, connected_at")
    .eq("organization_id", args.organizationId)
    .maybeSingle();

  const switched =
    !!existing &&
    (existing.provider !== args.provider || existing.external_id !== args.externalId);
  if (switched) {
    await Promise.all([
      admin
        .from("invoices")
        .update({ accounting_invoice_id: null, accounting_payment_id: null, accounting_synced_at: null })
        .eq("organization_id", args.organizationId),
      admin
        .from("customers")
        .update({ accounting_contact_id: null })
        .eq("organization_id", args.organizationId),
      admin
        .from("credit_notes")
        .update({ accounting_credit_note_id: null })
        .eq("organization_id", args.organizationId),
    ]);
    console.log("[accounting] provider switch — cleared entity mappings", {
      organizationId: args.organizationId,
      from: `${existing.provider}/${existing.external_id}`,
      to: `${args.provider}/${args.externalId}`,
    });
  }

  const { error } = await admin.from("accounting_connections").upsert(
    {
      organization_id: args.organizationId,
      provider: args.provider,
      external_id: args.externalId,
      display_name: args.displayName,
      access_token: encrypt(args.accessToken),
      refresh_token: encrypt(args.refreshToken),
      token_expires_at: args.tokenExpiresAt,
      connected_at:
        existing && !switched
          ? (existing.connected_at as string)
          : new Date().toISOString(),
      connected_by: args.connectedBy,
      needs_reconnect: false,
      last_refresh_error: null,
      last_refresh_error_at: null,
      reconnect_alerted_at: null,
    },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error(`saving accounting connection failed: ${error.message}`);
}

export async function deleteAccountingConnection(orgId: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("accounting_connections")
    .delete()
    .eq("organization_id", orgId);
  return error ? { error: error.message } : {};
}

// Token-free status row for UI (settings page, admin, support tools).
export type ConnectionStatus = {
  provider: AccountingProviderId;
  displayName: string | null;
  connectedAt: string;
  needsReconnect: boolean;
  lastRefreshError: string | null;
};

export async function getConnectionStatus(orgId: string): Promise<ConnectionStatus | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("accounting_connections")
    .select("provider, display_name, connected_at, needs_reconnect, last_refresh_error")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return null;
  return {
    provider: data.provider as AccountingProviderId,
    displayName: data.display_name as string | null,
    connectedAt: data.connected_at as string,
    needsReconnect: (data.needs_reconnect as boolean | null) === true,
    lastRefreshError: (data.last_refresh_error as string | null) ?? null,
  };
}
