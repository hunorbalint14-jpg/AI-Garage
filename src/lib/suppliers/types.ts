// Supplier connectivity seam (#568, epic #499). Everything that orders parts —
// the purchase-order screen today, the job screen's "find parts" tomorrow —
// talks to a SupplierConnector and never to a specific factor's API.
//
// Adding a trade-API connector (GSF / Euro Car Parts / Alliance) means:
//   1. Implement SupplierConnector in src/lib/suppliers/<vendor>-connector.ts.
//   2. Add its id to SupplierConnectorKind + CONNECTOR_LABELS below, and to
//      the `kind` check constraint on supplier_integrations.
//   3. Register it in connectors.ts (CONNECTORS map).
//   4. Add its credential fields to the settings card + env checklist.
// No caller changes. See docs/supplier-connectivity-spike.md.
//
// This module is pure types + constants (no server-only imports) so client
// components can import from it.

export type SupplierConnectorKind = "manual";

export const CONNECTOR_LABELS: Record<SupplierConnectorKind, string> = {
  manual: "Manual — punch-out / order email",
};

export const CONNECTOR_KINDS = Object.keys(CONNECTOR_LABELS) as SupplierConnectorKind[];

// Credential inputs a connector needs, rendered by the settings card and
// AES-encrypted as one JSON blob. The manual connector needs none — a trade
// API connector declares its fields here and gets the form for free.
export const CONNECTOR_CREDENTIAL_FIELDS: Record<
  SupplierConnectorKind,
  { name: string; label: string }[]
> = {
  manual: [],
};

export function isConnectorKind(value: string): value is SupplierConnectorKind {
  return (CONNECTOR_KINDS as string[]).includes(value);
}

// A supplier's ordering config as the app uses it. `hasCredentials` is the
// only thing ever told about the encrypted blob — values are write-only.
export type SupplierIntegration = {
  supplierId: string;
  locationId: string;
  kind: SupplierConnectorKind;
  enabled: boolean;
  punchoutUrlTemplate: string | null;
  orderEmail: string | null;
  accountNumber: string | null;
  hasCredentials: boolean;
  settings: Record<string, unknown>;
};

// Same, plus decrypted credentials — produced server-side by
// loadSupplierIntegration(); never construct one from raw DB values and never
// send one to the browser.
export type ResolvedSupplierIntegration = SupplierIntegration & {
  supplierName: string;
  /** Falls back to suppliers.contact_email when order_email is unset. */
  effectiveOrderEmail: string | null;
  credentials: Record<string, string>;
};

export type QuoteRequest = {
  /** UK registration, when the caller has one (job/vehicle context). */
  reg: string | null;
  /** Free-text part search, e.g. "front brake discs". */
  query: string;
};

export type QuotedLine = {
  sku: string | null;
  description: string;
  brand: string | null;
  /** Cost to the garage, ex VAT, in major units (GBP). */
  unitCost: number;
  /** null when the connector gives no stock figure. */
  availableQty: number | null;
};

// A quote either priced the parts (trade API), or could only hand the user off
// to the supplier's own catalogue (manual punch-out), or could do neither.
// Callers must handle all three — "unavailable" is the degraded path that
// falls back to the AI/manual entry from #567.
export type QuoteResult =
  | { outcome: "lines"; lines: QuotedLine[] }
  | { outcome: "punchout"; url: string }
  | { outcome: "unavailable"; reason: string };

export type OrderLine = {
  sku: string | null;
  description: string;
  quantity: number;
  /** Our expected cost ex VAT; the confirmation may correct it. */
  unitCost: number;
};

export type OrderRequest = {
  /** Our PO reference, quoted back by the supplier on their confirmation. */
  reference: string;
  lines: OrderLine[];
  notes: string | null;
  /** Garage identity for the order document — org + the ordering branch. */
  orgName: string;
  locationName: string | null;
  locationAddress: string | null;
  /** Where the supplier should reply (branch email, else the staff member). */
  replyTo: string | null;
};

// What placing an order actually did. The manual connector either emailed the
// order (channel "email") or produced a basket deep-link for a human to
// complete (channel "punchout") — in the punch-out case nothing has been sent
// yet, so the UI must send the user to `url`.
export type PlacedOrder = {
  channel: "email" | "punchout";
  /** Supplier's own reference, when the connector gets one back. */
  supplierOrderRef: string | null;
  /** Set for channel "punchout" — the basket URL to open. */
  url: string | null;
  /** Set for channel "email" — the address the order went to. */
  sentTo: string | null;
};

export type ConfirmedLine = {
  sku: string | null;
  description: string;
  quantity: number;
  /** Confirmed cost ex VAT per unit. */
  unitCost: number;
};

export type OrderConfirmation = {
  supplierOrderRef: string | null;
  lines: ConfirmedLine[];
};

export type ConnectorError = { error: string };

export function isConnectorError<T>(v: T | ConnectorError): v is ConnectorError {
  return typeof v === "object" && v !== null && "error" in v;
}

// One supplier's wire format. Implementations own only the vendor specifics;
// persistence, audit and stock stay in the callers.
export interface SupplierConnector {
  readonly kind: SupplierConnectorKind;
  /** Price + availability for a part search. */
  quote(req: QuoteRequest): Promise<QuoteResult>;
  /** Send the order. Never throws — returns { error } instead. */
  placeOrder(req: OrderRequest): Promise<PlacedOrder | ConnectorError>;
  /**
   * Poll the supplier for a confirmation of an order we placed. Returns null
   * when the connector can't fetch one (the manual connector never can —
   * confirmations are pasted in by hand and parsed with parseConfirmation).
   */
  fetchConfirmation(supplierOrderRef: string): Promise<OrderConfirmation | null>;
}
