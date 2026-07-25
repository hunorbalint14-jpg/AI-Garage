import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/encryption";
import { manualConnector } from "./manual-connector";
import type {
  ResolvedSupplierIntegration,
  SupplierConnector,
  SupplierConnectorKind,
  SupplierIntegration,
} from "./types";
import { isConnectorKind } from "./types";

// Connector registry. A new trade-API connector is one entry here plus its
// implementation file — see the checklist at the top of types.ts.
const CONNECTORS: Record<SupplierConnectorKind, (i: ResolvedSupplierIntegration) => SupplierConnector> = {
  manual: manualConnector,
};

type IntegrationRow = {
  supplier_id: string;
  location_id: string;
  kind: string;
  enabled: boolean;
  punchout_url_template: string | null;
  order_email: string | null;
  account_number: string | null;
  credentials: string | null;
  settings: Record<string, unknown> | null;
};

const COLUMNS =
  "supplier_id, location_id, kind, enabled, punchout_url_template, order_email, account_number, credentials, settings";

function toIntegration(row: IntegrationRow): SupplierIntegration {
  return {
    supplierId: row.supplier_id,
    locationId: row.location_id,
    // A row written before a connector kind was removed shouldn't crash the
    // page — fall back to manual, which every supplier can do.
    kind: isConnectorKind(row.kind) ? row.kind : "manual",
    enabled: row.enabled,
    punchoutUrlTemplate: row.punchout_url_template,
    orderEmail: row.order_email,
    accountNumber: row.account_number,
    hasCredentials: !!row.credentials,
    settings: row.settings ?? {},
  };
}

/** Ordering config for every supplier at a branch, keyed by supplier id. Never includes credential values. */
export async function listSupplierIntegrations(locationId: string): Promise<Map<string, SupplierIntegration>> {
  const admin = createAdminClient();
  const { data } = await admin.from("supplier_integrations").select(COLUMNS).eq("location_id", locationId);
  const map = new Map<string, SupplierIntegration>();
  for (const row of (data ?? []) as IntegrationRow[]) {
    map.set(row.supplier_id, toIntegration(row));
  }
  return map;
}

/**
 * Load one supplier's ordering config with credentials decrypted, plus the
 * supplier's name and the address orders fall back to. Server-only — the
 * result carries secrets and must never be returned to the browser.
 *
 * Returns null when the supplier has no integration row, or belongs to another
 * branch (the location filter is the tenancy check, not a nicety).
 */
export async function loadSupplierIntegration(
  supplierId: string,
  locationId: string,
): Promise<ResolvedSupplierIntegration | null> {
  const admin = createAdminClient();
  const [integrationRes, supplierRes] = await Promise.all([
    admin
      .from("supplier_integrations")
      .select(COLUMNS)
      .eq("supplier_id", supplierId)
      .eq("location_id", locationId)
      .maybeSingle(),
    admin
      .from("suppliers")
      .select("id, name, contact_email")
      .eq("id", supplierId)
      .eq("location_id", locationId)
      .maybeSingle(),
  ]);

  const row = integrationRes.data as IntegrationRow | null;
  const supplier = supplierRes.data as { id: string; name: string; contact_email: string | null } | null;
  if (!row || !supplier) return null;

  const base = toIntegration(row);

  // A credential blob we can't read (key rotated, corrupt row) must not take
  // the whole ordering path down — treat it as "no credentials".
  let credentials: Record<string, string> = {};
  if (row.credentials) {
    try {
      const parsed = JSON.parse(decrypt(row.credentials)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        credentials = parsed as Record<string, string>;
      }
    } catch (err) {
      console.error("[suppliers] could not decrypt credentials", { supplierId, err });
    }
  }

  return {
    ...base,
    supplierName: supplier.name,
    effectiveOrderEmail: (base.orderEmail || supplier.contact_email || "").trim() || null,
    credentials,
  };
}

/**
 * The connector to use for a supplier, or null when ordering isn't set up /
 * is switched off. Callers fall back to the manual paths when this is null.
 */
export async function getSupplierConnector(
  supplierId: string,
  locationId: string,
): Promise<{ connector: SupplierConnector; integration: ResolvedSupplierIntegration } | null> {
  const integration = await loadSupplierIntegration(supplierId, locationId);
  if (!integration || !integration.enabled) return null;
  return { connector: CONNECTORS[integration.kind](integration), integration };
}
