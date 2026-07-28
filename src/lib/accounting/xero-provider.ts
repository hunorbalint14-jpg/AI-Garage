import {
  BankTransaction,
  Contact,
  CreditNote,
  Invoice,
  LineAmountTypes,
  LineItem,
  Payment,
  Phone,
  XeroClient,
} from "xero-node";
import { publicOrigin } from "@/lib/stripe";
import type {
  AccountingConnection,
  AccountingProvider,
  ContactPayload,
  CreditNotePayload,
  InvoicePayload,
  PaymentPayload,
  PayoutPayload,
  RefreshedTokens,
  SalesLine,
} from "./types";

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

// Default revenue account code for ACCREC invoice lines. "200" = Sales
// in the Xero UK default chart of accounts. Override per-tenant later by
// reading a column off organizations if a garage runs a custom chart.
const DEFAULT_SALES_ACCOUNT_CODE =
  process.env.XERO_SALES_ACCOUNT_CODE ?? "200";

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

// Low-level refresh — refreshWithRefreshToken() doesn't need
// client.initialize() (which makes a discovery call to Xero); it just
// exchanges the refresh_token for a new token set directly. The old path
// (setTokenSet + refreshToken()) blew up with
//   TypeError: Cannot read properties of undefined (reading 'refresh')
// because the internal openid-client wasn't initialised.
export async function refreshXeroTokens(refreshToken: string): Promise<RefreshedTokens> {
  const client = makeXeroClient();
  const refreshed = await client.refreshWithRefreshToken(
    clientId(),
    clientSecret(),
    refreshToken,
  );
  if (!refreshed.access_token) throw new Error("Xero refresh returned no access token");
  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? refreshToken,
    expiresAt: new Date(
      (refreshed.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000,
    ).toISOString(),
  };
}

// Hydrate a stateful XeroClient from an already-refreshed connection.
function hydrate(conn: AccountingConnection): XeroClient {
  const client = makeXeroClient();
  client.setTokenSet({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken,
    expires_at: conn.tokenExpiresAt
      ? Math.floor(new Date(conn.tokenExpiresAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 1800,
    token_type: "Bearer",
    scope: XERO_SCOPES.join(" "),
  });
  return client;
}

// Escape a string for use inside a Xero `where` clause value. Xero
// expects double quotes around string values and "" to escape an
// internal double quote.
function xeroQuoteValue(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

// Map a provider-neutral line to a Xero LineItem. Xero UK income tax
// types: OUTPUT2 = 20% standard; ZERORATEDOUTPUT and EXEMPTOUTPUT keep
// zero-rated/exempt sales inside the VAT return (Box 6); NONE excludes
// the line entirely (outside-scope MOT fees, unregistered orgs).
const XERO_TAX_TYPES: Record<SalesLine["taxTreatment"], string> = {
  standard: "OUTPUT2",
  zero: "ZERORATEDOUTPUT",
  exempt: "EXEMPTOUTPUT",
  outside_scope: "NONE",
  no_vat: "NONE",
};

function toLineItem(line: SalesLine): LineItem {
  return {
    description: line.description,
    quantity: line.quantity,
    unitAmount: line.unitAmount,
    taxType: XERO_TAX_TYPES[line.taxTreatment],
    accountCode: DEFAULT_SALES_ACCOUNT_CODE,
  };
}

// First BANK account on the connected org — payments and payouts post
// here. Garages can move them later in Xero.
async function firstBankAccount(
  client: XeroClient,
  tenantId: string,
): Promise<{ accountID: string; code: string | null }> {
  const accountsRes = await client.accountingApi.getAccounts(
    tenantId,
    undefined,
    'Type=="BANK"',
  );
  const account = accountsRes.body.accounts?.[0];
  if (!account?.accountID) throw new Error("No BANK account found in Xero");
  return { accountID: account.accountID, code: account.code ?? null };
}

export const xeroProvider: AccountingProvider = {
  id: "xero",

  // Idempotent: pre-flight lookups by name then email — Xero enforces
  // unique contact names per org and rejects createContacts with HTTP 400
  // ValidationException if we duplicate. Cheaper than catching the error.
  async ensureContact(conn: AccountingConnection, contact: ContactPayload): Promise<string> {
    const client = hydrate(conn);

    try {
      const existingByName = await client.accountingApi.getContacts(
        conn.externalId,
        undefined,
        `Name=${xeroQuoteValue(contact.name)}`,
      );
      const hit = existingByName.body.contacts?.[0];
      if (hit?.contactID) return hit.contactID;
    } catch (err) {
      // Lookup is best-effort; fall through to create.
      console.warn("[accounting/xero] getContacts by name failed", err);
    }

    // Also search by email — a customer may have been added under a different
    // name on the Xero side but with the same email address.
    if (contact.email) {
      try {
        const existingByEmail = await client.accountingApi.getContacts(
          conn.externalId,
          undefined,
          `EmailAddress=${xeroQuoteValue(contact.email)}`,
        );
        const hit = existingByEmail.body.contacts?.[0];
        if (hit?.contactID) return hit.contactID;
      } catch (err) {
        console.warn("[accounting/xero] getContacts by email failed", err);
      }
    }

    const payload: Contact = {
      name: contact.name,
      emailAddress: contact.email ?? undefined,
      phones: contact.phone
        ? [{ phoneType: Phone.PhoneTypeEnum.DEFAULT, phoneNumber: contact.phone }]
        : undefined,
    };
    const res = await client.accountingApi.createContacts(conn.externalId, {
      contacts: [payload],
    });
    const created = res.body.contacts?.[0];
    if (!created?.contactID) throw new Error("Xero createContacts returned no contact");
    return created.contactID;
  },

  // Dedupe by our internal invoice id, carried on the Xero Reference
  // field. We do NOT match on InvoiceNumber because Xero invoice numbers
  // are not globally unique — Xero Demo Company seeds its own INV-0001+
  // sequence and our same-numbered invoices would collide with unrelated
  // seed rows, producing cross-customer mismapping.
  async findInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string | null> {
    const client = hydrate(conn);
    const existing = await client.accountingApi.getInvoices(
      conn.externalId,
      undefined,
      `Reference=${xeroQuoteValue(payload.referenceTag)}`,
    );
    const hit = existing.body.invoices?.[0];
    if (!hit?.invoiceID) return null;

    // If the existing row is still DRAFT or SUBMITTED (e.g. it was created
    // when this code mirrored our internal "draft" status, or Xero demoted
    // it due to a now-fixed validation issue), promote it to AUTHORISED so
    // the follow-up payment push can attach.
    if (
      hit.status === Invoice.StatusEnum.DRAFT ||
      hit.status === Invoice.StatusEnum.SUBMITTED
    ) {
      try {
        await client.accountingApi.updateInvoice(conn.externalId, hit.invoiceID, {
          invoices: [{ status: Invoice.StatusEnum.AUTHORISED }],
        });
        console.log("[accounting/xero] promoted Xero invoice to AUTHORISED", {
          ourInvoiceId: payload.ourInvoiceId,
          xeroInvoiceId: hit.invoiceID,
          previousStatus: hit.status,
        });
      } catch (err) {
        console.warn("[accounting/xero] promote to AUTHORISED failed", err);
      }
    }
    return hit.invoiceID;
  },

  async createInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string> {
    const client = hydrate(conn);

    // Always AUTHORISED — once we've created an invoice row in our DB it's
    // a real issued sales invoice, not a draft. DRAFT in Xero would block
    // any later payment push with "Payments can only be made against
    // Authorised documents".
    //
    // The AIG- prefix on the invoice number keeps it from colliding with
    // pre-existing rows on the connected org (Xero Demo Company UK seeds
    // its own INV-#### sequence; a naked "INV-0012" got demoted to
    // SUBMITTED with "Invoice # must be unique."). Garage staff still see
    // INV-#### in the AI Garage UI; their accountant sees AIG-INV-#### in
    // Xero. Reference is the unique dedupe key (our UUID) — invoice number
    // is purely a label.
    const xeroInvoice: Invoice = {
      type: Invoice.TypeEnum.ACCREC,
      contact: { contactID: payload.contactExternalId },
      invoiceNumber: `AIG-${payload.invoiceNumber}`,
      reference: payload.referenceTag,
      date: payload.issuedAt,
      dueDate: payload.dueAt,
      lineAmountTypes: LineAmountTypes.Exclusive,
      lineItems: payload.lines.map(toLineItem),
      status: Invoice.StatusEnum.AUTHORISED,
    };
    const res = await client.accountingApi.createInvoices(conn.externalId, {
      invoices: [xeroInvoice],
    });
    const created = res.body.invoices?.[0];
    if (!created?.invoiceID) throw new Error("Xero createInvoices returned no invoice");
    return created.invoiceID;
  },

  async createPayment(conn: AccountingConnection, payload: PaymentPayload): Promise<string> {
    const client = hydrate(conn);
    const bank = await firstBankAccount(client, conn.externalId);
    const payment: Payment = {
      invoice: { invoiceID: payload.externalInvoiceId },
      account: { accountID: bank.accountID },
      amount: payload.amount,
      date: payload.dateISO.split("T")[0],
      reference: payload.reference,
    };
    const res = await client.accountingApi.createPayment(conn.externalId, payment);
    const created = res.body.payments?.[0];
    if (!created?.paymentID) throw new Error("Xero createPayment returned no payment");
    return created.paymentID;
  },

  async findCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string | null> {
    const client = hydrate(conn);
    const existing = await client.accountingApi.getCreditNotes(
      conn.externalId,
      undefined,
      `Reference=${xeroQuoteValue(payload.referenceTag)}`,
    );
    return existing.body.creditNotes?.[0]?.creditNoteID ?? null;
  },

  // Created AUTHORISED but NOT auto-allocated against the original
  // invoice — the accountant allocates in Xero. Lines carry the refund's
  // actual VAT mix (buildCreditNoteLines) — never a hardcoded OUTPUT2.
  async createCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string> {
    const client = hydrate(conn);
    const creditNote: CreditNote = {
      type: CreditNote.TypeEnum.ACCRECCREDIT,
      contact: { contactID: payload.contactExternalId },
      reference: payload.referenceTag,
      date: new Date().toISOString().split("T")[0],
      lineAmountTypes: LineAmountTypes.Exclusive,
      lineItems: payload.lines.map(toLineItem),
      status: CreditNote.StatusEnum.AUTHORISED,
    };
    const res = await client.accountingApi.createCreditNotes(conn.externalId, {
      creditNotes: [creditNote],
    });
    const created = res.body.creditNotes?.[0];
    if (!created?.creditNoteID) throw new Error("Xero createCreditNotes returned no credit note");
    return created.creditNoteID;
  },

  // VOIDED only works on an AUTHORISED invoice with no payments applied —
  // exactly the window in which our deleteInvoice permits deletion. Xero
  // rejects the update otherwise and the orchestrator logs the failure.
  async voidInvoice(conn: AccountingConnection, externalInvoiceId: string): Promise<void> {
    const client = hydrate(conn);
    await client.accountingApi.updateInvoice(conn.externalId, externalInvoiceId, {
      invoices: [{ status: Invoice.StatusEnum.VOIDED }],
    });
  },

  // Receive Money bank transaction for a Stripe payout. Allocates to a
  // generic "Sales" line — accountant can recategorise later if they want
  // a separate Stripe payout account. NOTAX keeps this transaction from
  // double-counting VAT (VAT was already accounted for on the original
  // invoice). Fees (gross payments minus payout net) accumulate as
  // imbalance the accountant resolves as a quarterly "Stripe fees" Spend
  // Money — out of scope for v1.
  async createPayout(conn: AccountingConnection, payload: PayoutPayload): Promise<string> {
    const client = hydrate(conn);
    const bank = await firstBankAccount(client, conn.externalId);
    const txn: BankTransaction = {
      type: BankTransaction.TypeEnum.RECEIVE,
      contact: { name: "Stripe Payouts" },
      bankAccount: bank.code
        ? { accountID: bank.accountID, code: bank.code }
        : { accountID: bank.accountID },
      date: payload.date,
      reference: payload.reference,
      lineAmountTypes: LineAmountTypes.NoTax,
      lineItems: [
        {
          description: `Stripe payout ${payload.reference}`,
          quantity: 1,
          unitAmount: payload.amount,
          accountCode: DEFAULT_SALES_ACCOUNT_CODE,
          taxType: "NONE",
        },
      ],
    };
    const res = await client.accountingApi.createBankTransactions(conn.externalId, {
      bankTransactions: [txn],
    });
    const created = res.body.bankTransactions?.[0];
    if (!created?.bankTransactionID) {
      throw new Error("Xero createBankTransactions returned no transaction");
    }
    return created.bankTransactionID;
  },
};
