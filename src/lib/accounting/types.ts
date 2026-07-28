// Provider seam for accounting integrations (#501). The orchestrator in
// sync.ts owns everything provider-neutral: loading our rows, building
// payloads, idempotency via the accounting_* mapping columns, and the
// sync log. A provider implements only the wire format of one vendor.
//
// Adding a provider (e.g. Sage) means:
//   1. Implement AccountingProvider + a token-refresh function.
//   2. Register it in connection.ts (PROVIDERS map + refresh dispatch).
//   3. Add /api/<provider>/connect/{begin,callback} routes.
//   4. Add a card in the settings Integrations tab + env-checklist rows.
// See docs/accounting-providers.md.

import type { VatTreatment } from "@/lib/vat";

export type AccountingProviderId = "xero" | "quickbooks" | "sage";

export const PROVIDER_LABELS: Record<AccountingProviderId, string> = {
  xero: "Xero",
  quickbooks: "QuickBooks",
  sage: "Sage",
};

// A connection with tokens already decrypted and refreshed — produced by
// getAccountingConnection(); never construct one from raw DB values.
export type AccountingConnection = {
  organizationId: string;
  provider: AccountingProviderId;
  /** Xero tenantId / QuickBooks realmId */
  externalId: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string | null; // ISO
  connectedAt: string; // ISO
};

// Per-line tax treatment carried to the provider. The four VatTreatments
// map to the provider's distinct UK codes (zero-rated and exempt sales
// belong in Box 6 of the VAT return; outside-scope doesn't — collapsing
// them misstates the return the garage files from the package). "no_vat"
// = the org isn't VAT-registered, so no line carries any VAT meaning.
export type LineTaxTreatment = VatTreatment | "no_vat";

// One provider-neutral sales line. unitAmount is net (ex VAT) and may be
// negative (discounts, credits).
export type SalesLine = {
  description: string;
  quantity: number;
  unitAmount: number;
  taxTreatment: LineTaxTreatment;
};

export type ContactPayload = {
  name: string;
  email: string | null;
  phone: string | null;
};

export type InvoicePayload = {
  /** Our invoices.id — embedded in referenceTag for cross-provider dedupe. */
  ourInvoiceId: string;
  /** Display number, e.g. INV-0012. Providers prefix AIG- before sending. */
  invoiceNumber: string;
  /** AIG-<uuid> — the durable dedupe key carried on the provider record. */
  referenceTag: string;
  issuedAt: string; // ISO
  dueAt: string; // ISO
  lines: SalesLine[];
  contactExternalId: string;
};

export type PaymentPayload = {
  externalInvoiceId: string;
  /** Required by QuickBooks (Payment.CustomerRef); unused by Xero. */
  contactExternalId: string | null;
  /** Major units (GBP). */
  amount: number;
  dateISO: string;
  reference?: string;
};

export type CreditNotePayload = {
  /** Our credit_notes.id. */
  ourCreditNoteId: string;
  /** AIG-CN-<uuid> — dedupe key. */
  referenceTag: string;
  creditNumber: string | null;
  contactExternalId: string;
  /**
   * Net lines carrying the refund's actual VAT mix (built by
   * buildCreditNoteLines from the credit note's stored net + VAT — a
   * refund against a 0%-VAT invoice must not gain 20% provider-side).
   */
  lines: SalesLine[];
};

export type PayoutPayload = {
  /** Stripe payout id — used as the provider-side reference. */
  reference: string;
  /** Major units (GBP), net amount that arrives at the bank. */
  amount: number;
  /** YYYY-MM-DD arrival date. */
  date: string;
};

// All methods throw on hard failure — the orchestrator catches, writes an
// accounting_sync_log row, and returns null to the (fire-and-forget) caller.
// find* methods recover a lost local mapping by looking the record up on
// the provider side via the deterministic reference/doc number.
export interface AccountingProvider {
  id: AccountingProviderId;
  /** Find an existing contact by name/email or create one; returns external id. */
  ensureContact(conn: AccountingConnection, contact: ContactPayload): Promise<string>;
  findInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string | null>;
  createInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string>;
  createPayment(conn: AccountingConnection, payload: PaymentPayload): Promise<string>;
  findCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string | null>;
  createCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string>;
  /** Post a Stripe payout as a bank-side receive/deposit transaction. */
  createPayout(conn: AccountingConnection, payload: PayoutPayload): Promise<string>;
  /**
   * Void/delete the provider-side sales invoice. Throws if the provider
   * refuses (e.g. payments already applied) — the orchestrator logs the
   * failure so the orphan is visible instead of silent.
   */
  voidInvoice(conn: AccountingConnection, externalInvoiceId: string): Promise<void>;
}

export type RefreshedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO
};
