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

// QuickBooks Online (Intuit) — raw REST client. The official Node SDKs
// (intuit-oauth / node-quickbooks) are callback-era and unmaintained; the
// v3 API is plain JSON over HTTPS, so we talk to it directly.
//
// OAuth2: authorization-code flow, single scope. Access tokens last 1h;
// refresh tokens ROTATE on every refresh and expire after ~100 days of
// disuse — always persist the refresh_token returned by a refresh.
// The company (realm) id arrives as ?realmId= on the OAuth callback.

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const SCOPE = "com.intuit.quickbooks.accounting";
// Pin a minorversion so Intuit-side default bumps can't change response
// shapes under us.
const MINOR_VERSION = "75";

function clientId(): string {
  return process.env.QUICKBOOKS_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.QUICKBOOKS_CLIENT_SECRET ?? "";
}

// Sandbox and production are different hosts with disjoint realms/tokens.
// Default: sandbox everywhere except a production build, so a dev who
// forgets the env var can't post test invoices at a real company.
function apiBase(): string {
  const env =
    process.env.QUICKBOOKS_ENVIRONMENT ??
    (process.env.NODE_ENV === "production" ? "production" : "sandbox");
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export function quickBooksRedirectUri(): string {
  return `${publicOrigin()}/api/quickbooks/connect/callback`;
}

export function quickBooksAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: "code",
    scope: SCOPE,
    redirect_uri: quickBooksRedirectUri(),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams): Promise<RefreshedTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`QuickBooks token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token) {
    throw new Error("QuickBooks token endpoint returned no tokens");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function exchangeQuickBooksCode(code: string): Promise<RefreshedTokens> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: quickBooksRedirectUri(),
    }),
  );
}

export async function refreshQuickBooksTokens(refreshToken: string): Promise<RefreshedTokens> {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  );
}

// ── v3 API plumbing ──────────────────────────────────────────────────────

type QboAuth = { accessToken: string; realmId: string };

function authOf(conn: AccountingConnection): QboAuth {
  return { accessToken: conn.accessToken, realmId: conn.externalId };
}

async function qboApi<T>(
  auth: QboAuth,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${apiBase()}/v3/company/${auth.realmId}${path}${sep}minorversion=${MINOR_VERSION}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // Business errors: { Fault: { Error: [{ Message, Detail, code }] } };
    // auth errors use lowercase { fault: { error: [{ message, detail }] } }.
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      type FaultError = { Message?: string; Detail?: string; code?: string; message?: string; detail?: string };
      const body = JSON.parse(text) as {
        Fault?: { Error?: FaultError[] };
        fault?: { error?: FaultError[] };
      };
      const first = body.Fault?.Error?.[0] ?? body.fault?.error?.[0];
      if (first) {
        const msg = first.Message ?? first.message ?? "";
        const det = first.Detail ?? first.detail ?? "";
        detail = `${msg} — ${det}${first.code ? ` (code ${first.code})` : ""}`;
      }
    } catch {
      // keep raw text
    }
    throw new Error(`QuickBooks ${method} ${path.split("?")[0]} ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

// QBO query language escaping: backslash-escape quotes inside the
// single-quoted string literal. Exported for tests.
export function qboQuoteValue(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

type QueryResponse<K extends string, T> = {
  QueryResponse: Partial<Record<K, T[]>>;
};

async function qboQuery<K extends string, T>(
  auth: QboAuth,
  entity: K,
  where: string,
): Promise<T[]> {
  const q = `select * from ${entity} where ${where}`;
  const res = await qboApi<QueryResponse<K, T>>(
    auth,
    "GET",
    `/query?query=${encodeURIComponent(q)}`,
  );
  return res.QueryResponse[entity] ?? [];
}

export async function fetchQuickBooksCompanyName(
  accessToken: string,
  realmId: string,
): Promise<string | null> {
  try {
    const res = await qboApi<{ CompanyInfo?: { CompanyName?: string } }>(
      { accessToken, realmId },
      "GET",
      `/companyinfo/${realmId}`,
    );
    return res.CompanyInfo?.CompanyName ?? null;
  } catch (err) {
    console.warn("[accounting/quickbooks] companyinfo fetch failed", err);
    return null;
  }
}

// DocNumber is capped at 21 characters in QBO. Exported for tests.
export function docNumber(raw: string): string {
  return raw.slice(0, 21);
}

// Deterministic DocNumber for a credit note — used for both create and
// the dedupe lookup (PrivateNote is not queryable in QBO, so DocNumber
// carries the dedupe key, unlike Xero where Reference does). Exported
// for tests.
export function creditNoteDocNumber(payload: CreditNotePayload): string {
  return payload.creditNumber
    ? docNumber(`AIG-${payload.creditNumber}`)
    : docNumber(`AIG-CN-${payload.ourCreditNoteId.replace(/-/g, "").slice(-12)}`);
}

// ── Reference data (resolved per push — a handful of cheap queries) ─────

type QboRef = { value: string };
type QboAccount = { Id: string; Name?: string; AccountType?: string };
type QboItem = { Id: string; Name?: string };
type QboTaxCode = { Id: string; Name?: string };

const SALES_ITEM_NAME = "AI Garage Sales";

async function firstIncomeAccount(auth: QboAuth): Promise<QboAccount> {
  const accounts = await qboQuery<"Account", QboAccount>(
    auth,
    "Account",
    "AccountType = 'Income'",
  );
  if (!accounts[0]) throw new Error("No Income account found in QuickBooks");
  return accounts[0];
}

async function firstBankAccount(auth: QboAuth): Promise<QboAccount> {
  const accounts = await qboQuery<"Account", QboAccount>(
    auth,
    "Account",
    "AccountType = 'Bank'",
  );
  if (!accounts[0]) throw new Error("No Bank account found in QuickBooks");
  return accounts[0];
}

// Every QBO sales line needs an ItemRef. We keep a single Service item —
// revenue categorisation happens on its income account, mirroring the
// single sales account code we use on the Xero side.
async function ensureSalesItem(auth: QboAuth): Promise<QboRef> {
  const existing = await qboQuery<"Item", QboItem>(
    auth,
    "Item",
    `Name = ${qboQuoteValue(SALES_ITEM_NAME)}`,
  );
  if (existing[0]?.Id) return { value: existing[0].Id };

  const income = await firstIncomeAccount(auth);
  const res = await qboApi<{ Item?: QboItem }>(auth, "POST", "/item", {
    Name: SALES_ITEM_NAME,
    Type: "Service",
    IncomeAccountRef: { value: income.Id },
  });
  if (!res.Item?.Id) throw new Error("QuickBooks item create returned no item");
  return { value: res.Item.Id };
}

// UK QBO tax codes are realm-specific rows, so we resolve by name:
// "20.0% S" = standard rate; "No VAT" (fallback "Exempt", then a
// zero-rated code) plays the role Xero's NONE does for 0% lines.
async function resolveTaxCodes(auth: QboAuth): Promise<{ standard: QboRef; none: QboRef }> {
  const codes = await qboQuery<"TaxCode", QboTaxCode>(auth, "TaxCode", "Active = true");
  const byName = (re: RegExp) => codes.find((c) => re.test(c.Name ?? ""));
  const standard = byName(/^20\.0% s/i) ?? byName(/20\.0%/);
  const none = byName(/^no vat/i) ?? byName(/^exempt/i) ?? byName(/^0\.00?% z/i);
  if (!standard?.Id) {
    throw new Error("No 20% standard-rate tax code found in QuickBooks (is the company UK VAT-enabled?)");
  }
  if (!none?.Id) throw new Error("No zero/No-VAT tax code found in QuickBooks");
  return { standard: { value: standard.Id }, none: { value: none.Id } };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toSalesLine(
  line: SalesLine,
  itemRef: QboRef,
  tax: { standard: QboRef; none: QboRef },
) {
  return {
    DetailType: "SalesItemLineDetail",
    Amount: round2(line.quantity * line.unitAmount),
    Description: line.description,
    SalesItemLineDetail: {
      ItemRef: itemRef,
      Qty: line.quantity,
      UnitPrice: line.unitAmount,
      TaxCodeRef: line.standardRated ? tax.standard : tax.none,
    },
  };
}

// ── Provider ─────────────────────────────────────────────────────────────

export const quickBooksProvider: AccountingProvider = {
  id: "quickbooks",

  // DisplayName is unique per realm (duplicate create fails with error
  // 6240), so pre-flight by name, then by email — same shape as Xero.
  async ensureContact(conn: AccountingConnection, contact: ContactPayload): Promise<string> {
    const auth = authOf(conn);

    try {
      const byName = await qboQuery<"Customer", { Id: string }>(
        auth,
        "Customer",
        `DisplayName = ${qboQuoteValue(contact.name)}`,
      );
      if (byName[0]?.Id) return byName[0].Id;
    } catch (err) {
      console.warn("[accounting/quickbooks] customer lookup by name failed", err);
    }

    if (contact.email) {
      try {
        const byEmail = await qboQuery<"Customer", { Id: string }>(
          auth,
          "Customer",
          `PrimaryEmailAddr = ${qboQuoteValue(contact.email)}`,
        );
        if (byEmail[0]?.Id) return byEmail[0].Id;
      } catch (err) {
        console.warn("[accounting/quickbooks] customer lookup by email failed", err);
      }
    }

    const res = await qboApi<{ Customer?: { Id: string } }>(auth, "POST", "/customer", {
      DisplayName: contact.name,
      ...(contact.email ? { PrimaryEmailAddr: { Address: contact.email } } : {}),
      ...(contact.phone ? { PrimaryPhone: { FreeFormNumber: contact.phone } } : {}),
    });
    if (!res.Customer?.Id) throw new Error("QuickBooks customer create returned no customer");
    return res.Customer.Id;
  },

  // PrivateNote isn't queryable, so DocNumber (AIG-<number>, unique per
  // org thanks to per-branch invoice prefixes) is the dedupe key here.
  async findInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string | null> {
    const hits = await qboQuery<"Invoice", { Id: string }>(
      authOf(conn),
      "Invoice",
      `DocNumber = ${qboQuoteValue(docNumber(`AIG-${payload.invoiceNumber}`))}`,
    );
    return hits[0]?.Id ?? null;
  },

  async createInvoice(conn: AccountingConnection, payload: InvoicePayload): Promise<string> {
    const auth = authOf(conn);
    const [itemRef, tax] = await Promise.all([ensureSalesItem(auth), resolveTaxCodes(auth)]);

    const res = await qboApi<{ Invoice?: { Id: string } }>(auth, "POST", "/invoice", {
      CustomerRef: { value: payload.contactExternalId },
      DocNumber: docNumber(`AIG-${payload.invoiceNumber}`),
      TxnDate: payload.issuedAt.split("T")[0],
      DueDate: payload.dueAt.split("T")[0],
      // Our line amounts are net; QBO adds VAT per line's TaxCodeRef.
      GlobalTaxCalculation: "TaxExcluded",
      PrivateNote: payload.referenceTag,
      Line: payload.lines.map((l) => toSalesLine(l, itemRef, tax)),
    });
    if (!res.Invoice?.Id) throw new Error("QuickBooks invoice create returned no invoice");
    return res.Invoice.Id;
  },

  // No DepositToAccountRef → the payment lands in Undeposited Funds, the
  // correct staging account for card takings that reach the bank later as
  // a batched Stripe payout.
  async createPayment(conn: AccountingConnection, payload: PaymentPayload): Promise<string> {
    if (!payload.contactExternalId) {
      throw new Error("QuickBooks payment needs the customer's external id");
    }
    const res = await qboApi<{ Payment?: { Id: string } }>(authOf(conn), "POST", "/payment", {
      CustomerRef: { value: payload.contactExternalId },
      TotalAmt: payload.amount,
      TxnDate: payload.dateISO.split("T")[0],
      ...(payload.reference ? { PaymentRefNum: payload.reference.slice(0, 21) } : {}),
      Line: [
        {
          Amount: payload.amount,
          LinkedTxn: [{ TxnId: payload.externalInvoiceId, TxnType: "Invoice" }],
        },
      ],
    });
    if (!res.Payment?.Id) throw new Error("QuickBooks payment create returned no payment");
    return res.Payment.Id;
  },

  async findCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string | null> {
    const hits = await qboQuery<"CreditMemo", { Id: string }>(
      authOf(conn),
      "CreditMemo",
      `DocNumber = ${qboQuoteValue(creditNoteDocNumber(payload))}`,
    );
    return hits[0]?.Id ?? null;
  },

  // Not auto-applied against the original invoice — the accountant
  // allocates it in QuickBooks, mirroring the Xero behaviour.
  async createCreditNote(conn: AccountingConnection, payload: CreditNotePayload): Promise<string> {
    const auth = authOf(conn);
    const [itemRef, tax] = await Promise.all([ensureSalesItem(auth), resolveTaxCodes(auth)]);

    const res = await qboApi<{ CreditMemo?: { Id: string } }>(auth, "POST", "/creditmemo", {
      CustomerRef: { value: payload.contactExternalId },
      DocNumber: creditNoteDocNumber(payload),
      TxnDate: new Date().toISOString().split("T")[0],
      GlobalTaxCalculation: "TaxExcluded",
      PrivateNote: payload.referenceTag,
      Line: [
        toSalesLine(
          { description: payload.description, quantity: 1, unitAmount: payload.amount, standardRated: true },
          itemRef,
          tax,
        ),
      ],
    });
    if (!res.CreditMemo?.Id) throw new Error("QuickBooks credit memo create returned no credit memo");
    return res.CreditMemo.Id;
  },

  // Stripe payout → Deposit into the first Bank account. Same v1 caveat
  // as the Xero side: the deposit line books against the income account,
  // and Stripe fees remain an imbalance the accountant resolves.
  async createPayout(conn: AccountingConnection, payload: PayoutPayload): Promise<string> {
    const auth = authOf(conn);
    const [bank, income] = await Promise.all([firstBankAccount(auth), firstIncomeAccount(auth)]);

    const res = await qboApi<{ Deposit?: { Id: string } }>(auth, "POST", "/deposit", {
      DepositToAccountRef: { value: bank.Id },
      TxnDate: payload.date,
      PrivateNote: `Stripe payout ${payload.reference}`,
      Line: [
        {
          Amount: payload.amount,
          DetailType: "DepositLineDetail",
          Description: `Stripe payout ${payload.reference}`,
          DepositLineDetail: { AccountRef: { value: income.Id } },
        },
      ],
    });
    if (!res.Deposit?.Id) throw new Error("QuickBooks deposit create returned no deposit");
    return res.Deposit.Id;
  },
};
