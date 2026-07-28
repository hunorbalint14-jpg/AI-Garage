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

// Sage Business Cloud Accounting (API v3.1) — raw REST client, same
// stance as the QuickBooks provider. Wire format verified against the
// official OpenAPI spec (sage-accounting-3.1.0.json).
//
// OAuth2 quirks vs the other providers:
// - Access tokens live FIVE MINUTES (expires_in 300) — nearly every sync
//   run refreshes first. Refresh tokens rotate on every use and die
//   after 31 days unused; a lost/expired refresh token has no recovery
//   path except the owner reconnecting.
// - A Sage user can own several businesses; the callback picks via
//   GET /businesses and the business id (our external_id) must ride
//   every data request as the X-Business header.

const AUTH_URL = "https://www.sageone.com/oauth2/auth/central";
const TOKEN_URL = "https://oauth.accounting.sage.com/token";
const API_BASE = "https://api.accounting.sage.com/v3.1";
const SCOPE = "full_access";

function clientId(): string {
  return process.env.SAGE_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.SAGE_CLIENT_SECRET ?? "";
}

export function sageRedirectUri(): string {
  return `${publicOrigin()}/api/sage/connect/callback`;
}

export function sageAuthUrl(state: string): string {
  const params = new URLSearchParams({
    // filter=apiv3.1 keeps the Sage login screen scoped to products the
    // v3.1 API can actually talk to.
    filter: "apiv3.1",
    client_id: clientId(),
    response_type: "code",
    redirect_uri: sageRedirectUri(),
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<RefreshedTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sage token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new Error("Sage token endpoint returned no tokens");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 300) * 1000).toISOString(),
  };
}

export async function exchangeSageCode(code: string): Promise<RefreshedTokens> {
  return tokenRequest(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "authorization_code",
      code,
      redirect_uri: sageRedirectUri(),
    }),
  );
}

export async function refreshSageTokens(refreshToken: string): Promise<RefreshedTokens> {
  return tokenRequest(
    new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

// ── v3.1 API plumbing ────────────────────────────────────────────────────

type SageAuth = { accessToken: string; businessId: string | null };

function authOf(conn: AccountingConnection): SageAuth {
  return { accessToken: conn.accessToken, businessId: conn.externalId };
}

async function sageApi<T>(
  auth: SageAuth,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
      // Selects which of the user's businesses the request targets.
      ...(auth.businessId ? { "X-Business": auth.businessId } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Validation errors arrive as an array of
    // { $severity, $dataCode, message, $source }; auth errors as a
    // plain { error, error_description } object. Parse both.
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        const first = parsed[0] as { message?: string; $dataCode?: string; $source?: string };
        if (first?.message) {
          detail = `${first.message}${first.$source ? ` (${first.$source})` : ""}${first.$dataCode ? ` [${first.$dataCode}]` : ""}`;
        }
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as { error?: string; error_description?: string; message?: string };
        if (obj.error_description || obj.message) {
          detail = `${obj.error ?? ""} ${obj.error_description ?? obj.message ?? ""}`.trim();
        }
      }
    } catch {
      // keep raw text
    }
    throw new Error(`Sage ${method} ${path.split("?")[0]} ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

type SagePage<T> = { $items?: T[] };

// The user's businesses — called from the OAuth callback (before a
// connection row exists) to pick the business the connection binds to.
export async function fetchSageBusinesses(
  accessToken: string,
): Promise<{ id: string; displayedAs: string | null }[]> {
  const res = await sageApi<SagePage<{ id: string; displayed_as?: string }>>(
    { accessToken, businessId: null },
    "GET",
    "/businesses",
  );
  return (res.$items ?? []).map((b) => ({ id: b.id, displayedAs: b.displayed_as ?? null }));
}

// Sage UI validation caps reference fields around 25 characters (the
// spec doesn't declare it, the product enforces it), so the dedupe tag
// is a short deterministic digest of our uuid rather than the full
// AIG-<uuid> the other providers carry. Exported for tests.
export function sageReference(prefix: string, uuid: string): string {
  return `${prefix}${uuid.replace(/-/g, "").slice(-12)}`;
}

// ── Reference data (resolved per push, like the QuickBooks provider) ─────

type SageTaxRate = { id: string; name?: string; percentage?: number };
type SageLedgerAccount = { id: string; displayed_as?: string };
type SageBankAccount = { id: string; displayed_as?: string };

// UK ids are GB_STANDARD / GB_ZERO / GB_EXEMPT / GB_NO_TAX; match by id
// first and fall back to the percentage so a non-GB business still
// resolves. The three 0% rates are distinct because they land in
// different boxes of the VAT return; a missing one falls back within the
// 0% family, never to the standard rate.
type SageTaxIds = Record<SalesLine["taxTreatment"], string>;

async function resolveTaxRates(auth: SageAuth): Promise<SageTaxIds> {
  const res = await sageApi<SagePage<SageTaxRate>>(auth, "GET", "/tax_rates?items_per_page=200");
  const rates = res.$items ?? [];
  const byId = (id: string) => rates.find((r) => r.id === id);
  const standard = byId("GB_STANDARD") ?? rates.find((r) => Number(r.percentage) === 20);
  const anyZeroPct = rates.find((r) => Number(r.percentage) === 0);
  const zero = byId("GB_ZERO") ?? byId("GB_EXEMPT") ?? byId("GB_NO_TAX") ?? anyZeroPct;
  const exempt = byId("GB_EXEMPT") ?? byId("GB_NO_TAX") ?? byId("GB_ZERO") ?? anyZeroPct;
  const noTax = byId("GB_NO_TAX") ?? byId("GB_EXEMPT") ?? byId("GB_ZERO") ?? anyZeroPct;
  if (!standard) throw new Error("No 20% standard tax rate found in Sage (is the business UK?)");
  if (!zero || !exempt || !noTax) throw new Error("No zero/no-tax rate found in Sage");
  return {
    standard: standard.id,
    zero: zero.id,
    exempt: exempt.id,
    outside_scope: noTax.id,
    no_vat: noTax.id,
  };
}

// First sales-visible ledger account, preferring one labelled "Sales" —
// the single revenue account, mirroring Xero's account code 200 and the
// QuickBooks income account.
async function resolveSalesLedgerAccount(auth: SageAuth): Promise<string> {
  const res = await sageApi<SagePage<SageLedgerAccount>>(
    auth,
    "GET",
    "/ledger_accounts?visible_in=sales&items_per_page=200",
  );
  const accounts = res.$items ?? [];
  const preferred = accounts.find((a) => /(^|\s)sales(\s|$)/i.test(a.displayed_as ?? ""));
  const pick = preferred ?? accounts[0];
  if (!pick) throw new Error("No sales ledger account found in Sage");
  return pick.id;
}

async function firstBankAccount(auth: SageAuth): Promise<string> {
  const res = await sageApi<SagePage<SageBankAccount>>(auth, "GET", "/bank_accounts");
  const pick = res.$items?.[0];
  if (!pick) throw new Error("No bank account found in Sage");
  return pick.id;
}

function toInvoiceLine(line: SalesLine, ledgerAccountId: string, tax: SageTaxIds) {
  return {
    description: line.description,
    ledger_account_id: ledgerAccountId,
    quantity: line.quantity,
    unit_price: line.unitAmount,
    tax_rate_id: tax[line.taxTreatment],
  };
}

// Look an artefact (invoice / credit note) up by our reference tag.
// Sage's `search` matches references among other fields; we re-check the
// exact reference on the hits before trusting one.
async function findByReference(
  auth: SageAuth,
  path: "/sales_invoices" | "/sales_credit_notes",
  reference: string,
): Promise<string | null> {
  const res = await sageApi<SagePage<{ id: string; reference?: string }>>(
    auth,
    "GET",
    `${path}?search=${encodeURIComponent(reference)}&items_per_page=20`,
  );
  return (res.$items ?? []).find((i) => i.reference === reference)?.id ?? null;
}

// ── Provider ─────────────────────────────────────────────────────────────

export const sageProvider: AccountingProvider = {
  id: "sage",

  // Pre-flight by the dedicated email filter, then name search scoped to
  // customers. Sage does not enforce unique contact names, so this is
  // dedupe hygiene rather than error avoidance.
  async ensureContact(conn: AccountingConnection, contact: ContactPayload): Promise<string> {
    const auth = authOf(conn);

    if (contact.email) {
      try {
        const byEmail = await sageApi<SagePage<{ id: string }>>(
          auth,
          "GET",
          `/contacts?email=${encodeURIComponent(contact.email)}&contact_type_id=CUSTOMER`,
        );
        if (byEmail.$items?.[0]?.id) return byEmail.$items[0].id;
      } catch (err) {
        console.warn("[accounting/sage] contact lookup by email failed", err);
      }
    }
    try {
      const byName = await sageApi<SagePage<{ id: string; displayed_as?: string }>>(
        auth,
        "GET",
        `/contacts?search=${encodeURIComponent(contact.name)}&contact_type_id=CUSTOMER`,
      );
      const exact = (byName.$items ?? []).find((c) => c.displayed_as === contact.name);
      if (exact?.id) return exact.id;
    } catch (err) {
      console.warn("[accounting/sage] contact lookup by name failed", err);
    }

    const res = await sageApi<{ id?: string }>(auth, "POST", "/contacts", {
      contact: {
        name: contact.name,
        contact_type_ids: ["CUSTOMER"],
        ...(contact.email || contact.phone
          ? {
              main_contact_person: {
                name: contact.name,
                is_main_contact: true,
                ...(contact.email ? { email: contact.email } : {}),
                ...(contact.phone ? { telephone: contact.phone } : {}),
              },
            }
          : {}),
      },
    });
    if (!res.id) throw new Error("Sage contact create returned no id");
    return res.id;
  },

  async findInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string | null> {
    return findByReference(
      authOf(conn),
      "/sales_invoices",
      sageReference("AIG-", payload.ourInvoiceId),
    );
  },

  // A posted sales_invoice is final in Sage (no draft/authorised split to
  // manage). Deductions ride as negative-unit-price lines like the other
  // providers, keeping Sage's VAT on the same net we charged.
  async createInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string> {
    const auth = authOf(conn);
    const [tax, ledgerAccountId] = await Promise.all([
      resolveTaxRates(auth),
      resolveSalesLedgerAccount(auth),
    ]);
    const res = await sageApi<{ id?: string }>(auth, "POST", "/sales_invoices", {
      sales_invoice: {
        contact_id: payload.contactExternalId,
        date: payload.issuedAt.split("T")[0],
        due_date: payload.dueAt.split("T")[0],
        reference: sageReference("AIG-", payload.ourInvoiceId),
        invoice_lines: payload.lines.map((l) => toInvoiceLine(l, ledgerAccountId, tax)),
      },
    });
    if (!res.id) throw new Error("Sage sales invoice create returned no id");
    return res.id;
  },

  // CUSTOMER_RECEIPT allocated against the invoice artefact, into the
  // first bank account (same fallback as the Xero provider).
  async createPayment(conn: AccountingConnection, payload: PaymentPayload): Promise<string> {
    if (!payload.contactExternalId) {
      throw new Error("Sage payment needs the customer's external id");
    }
    const auth = authOf(conn);
    const bankAccountId = await firstBankAccount(auth);
    const res = await sageApi<{ id?: string }>(auth, "POST", "/contact_payments", {
      contact_payment: {
        transaction_type_id: "CUSTOMER_RECEIPT",
        contact_id: payload.contactExternalId,
        bank_account_id: bankAccountId,
        date: payload.dateISO.split("T")[0],
        total_amount: payload.amount,
        ...(payload.reference ? { reference: payload.reference.slice(0, 25) } : {}),
        allocated_artefacts: [{ artefact_id: payload.externalInvoiceId, amount: payload.amount }],
      },
    });
    if (!res.id) throw new Error("Sage contact payment create returned no id");
    return res.id;
  },

  async findCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string | null> {
    return findByReference(
      authOf(conn),
      "/sales_credit_notes",
      sageReference("AIGCN-", payload.ourCreditNoteId),
    );
  },

  // Not auto-allocated against the original invoice — the accountant
  // allocates in Sage, mirroring the other providers. Lines carry the
  // refund's actual VAT mix (buildCreditNoteLines).
  async createCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string> {
    const auth = authOf(conn);
    const [tax, ledgerAccountId] = await Promise.all([
      resolveTaxRates(auth),
      resolveSalesLedgerAccount(auth),
    ]);
    const res = await sageApi<{ id?: string }>(auth, "POST", "/sales_credit_notes", {
      sales_credit_note: {
        contact_id: payload.contactExternalId,
        date: new Date().toISOString().split("T")[0],
        reference: sageReference("AIGCN-", payload.ourCreditNoteId),
        credit_note_lines: payload.lines.map((l) => toInvoiceLine(l, ledgerAccountId, tax)),
      },
    });
    if (!res.id) throw new Error("Sage sales credit note create returned no id");
    return res.id;
  },

  // Sage has no void — DELETE removes an unallocated, unpaid sales
  // invoice; the API rejects it once payments/allocations exist.
  async voidInvoice(conn: AccountingConnection, externalInvoiceId: string): Promise<void> {
    const auth = authOf(conn);
    const res = await fetch(`${API_BASE}/sales_invoices/${externalInvoiceId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: "application/json",
        ...(auth.businessId ? { "X-Business": auth.businessId } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => "");
      throw new Error(`Sage DELETE /sales_invoices ${res.status}: ${text.slice(0, 300)}`);
    }
  },

  // Stripe payout → OTHER_RECEIPT into the first bank account, booked
  // against the sales ledger account with the no-tax rate. Same v1
  // caveat as the other providers: Stripe fees stay an imbalance the
  // accountant resolves.
  async createPayout(conn: AccountingConnection, payload: PayoutPayload): Promise<string> {
    const auth = authOf(conn);
    const [tax, ledgerAccountId, bankAccountId] = await Promise.all([
      resolveTaxRates(auth),
      resolveSalesLedgerAccount(auth),
      firstBankAccount(auth),
    ]);
    const res = await sageApi<{ id?: string }>(auth, "POST", "/other_payments", {
      other_payment: {
        transaction_type_id: "OTHER_RECEIPT",
        bank_account_id: bankAccountId,
        date: payload.date,
        total_amount: payload.amount,
        reference: payload.reference.slice(0, 25),
        payment_lines: [
          {
            ledger_account_id: ledgerAccountId,
            total_amount: payload.amount,
            tax_rate_id: tax.no_vat,
            details: `Stripe payout ${payload.reference}`.slice(0, 60),
          },
        ],
      },
    });
    if (!res.id) throw new Error("Sage other payment create returned no id");
    return res.id;
  },
};
