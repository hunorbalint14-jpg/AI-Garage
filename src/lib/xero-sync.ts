import {
  BankTransaction,
  Contact,
  Invoice,
  LineAmountTypes,
  LineItem,
  Payment,
  Phone,
} from "xero-node";
import { createAdminClient } from "@/lib/supabase/admin";
import { getXeroClientForOrg } from "@/lib/xero";

// Default revenue account code for ACCREC invoice lines. "200" = Sales
// in the Xero UK default chart of accounts. Override per-tenant later by
// reading a column off organizations if a garage runs a custom chart.
const DEFAULT_SALES_ACCOUNT_CODE =
  process.env.XERO_SALES_ACCOUNT_CODE ?? "200";

// Escape a string for use inside a Xero `where` clause value. Xero
// expects double quotes around string values and "" to escape an
// internal double quote.
function xeroQuoteValue(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

// Idempotent helper: returns the Xero ContactID for a customer, creating
// the Xero contact on first call. If Xero already has a contact with the
// same name (Xero rejects duplicate names with a ValidationException),
// we look it up and reuse the existing ContactID instead.
async function ensureXeroContact(args: {
  orgId: string;
  customerId: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone, xero_contact_id")
    .eq("id", args.customerId)
    .maybeSingle();
  if (!customer) return null;
  if (customer.xero_contact_id) return customer.xero_contact_id as string;

  const conn = await getXeroClientForOrg(args.orgId);
  if (!conn) return null;

  const name = customer.full_name ?? customer.email ?? "Customer";

  // Pre-flight: does a contact with this name already exist? Xero enforces
  // unique contact names per org and rejects createContacts with HTTP 400
  // ValidationException if we duplicate. Cheaper than catching the error.
  try {
    const existingByName = await conn.client.accountingApi.getContacts(
      conn.tenantId,
      undefined,
      `Name=${xeroQuoteValue(name)}`,
    );
    const hit = existingByName.body.contacts?.[0];
    if (hit?.contactID) {
      await admin
        .from("customers")
        .update({ xero_contact_id: hit.contactID })
        .eq("id", args.customerId);
      return hit.contactID;
    }
  } catch (err) {
    // Lookup is best-effort; fall through to create.
    console.warn("[xero-sync] getContacts by name failed", err);
  }

  // Also search by email — a customer may have been added under a different
  // name on the Xero side but with the same email address.
  if (customer.email) {
    try {
      const existingByEmail = await conn.client.accountingApi.getContacts(
        conn.tenantId,
        undefined,
        `EmailAddress=${xeroQuoteValue(customer.email)}`,
      );
      const hit = existingByEmail.body.contacts?.[0];
      if (hit?.contactID) {
        await admin
          .from("customers")
          .update({ xero_contact_id: hit.contactID })
          .eq("id", args.customerId);
        return hit.contactID;
      }
    } catch (err) {
      console.warn("[xero-sync] getContacts by email failed", err);
    }
  }

  const contact: Contact = {
    name,
    emailAddress: customer.email ?? undefined,
    phones: customer.phone
      ? [{ phoneType: Phone.PhoneTypeEnum.DEFAULT, phoneNumber: customer.phone }]
      : undefined,
  };

  try {
    const res = await conn.client.accountingApi.createContacts(
      conn.tenantId,
      { contacts: [contact] },
    );
    const created = res.body.contacts?.[0];
    if (!created?.contactID) return null;
    await admin
      .from("customers")
      .update({ xero_contact_id: created.contactID })
      .eq("id", args.customerId);
    return created.contactID;
  } catch (err) {
    console.error("[xero-sync] createContact failed", err);
    return null;
  }
}

// Push an invoice (with its job_items OR booking line) to Xero as an
// ACCREC (sales) invoice. Idempotent: if xero_invoice_id is already set
// on the row, exits silently. Returns the Xero InvoiceID on success.
export async function pushInvoiceToXero(invoiceId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select(
      "id, location_id, customer_id, job_id, booking_id, invoice_number, subtotal, vat_rate, vat_amount, total, issued_at, due_at, notes, status, xero_invoice_id, location:locations(organization_id)",
    )
    .eq("id", invoiceId)
    .maybeSingle();

  type InvRow = {
    id: string;
    location_id: string;
    customer_id: string;
    job_id: string | null;
    booking_id: string | null;
    invoice_number: string;
    subtotal: number;
    vat_rate: number;
    vat_amount: number;
    total: number;
    issued_at: string;
    due_at: string;
    notes: string | null;
    status: string;
    xero_invoice_id: string | null;
    location: { organization_id: string } | null;
  };
  const inv = invoice as unknown as InvRow | null;
  if (!inv) return null;
  if (inv.xero_invoice_id) return inv.xero_invoice_id;
  const orgId = inv.location?.organization_id;
  if (!orgId) return null;

  const conn = await getXeroClientForOrg(orgId);
  if (!conn) return null;

  const contactId = await ensureXeroContact({ orgId, customerId: inv.customer_id });
  if (!contactId) return null;

  // Build line items. Job invoices have job_items; booking invoices have
  // a single synthesised service line.
  let lineItems: LineItem[] = [];
  if (inv.job_id) {
    const { data: items } = await admin
      .from("job_items")
      .select("description, type, quantity, unit_price")
      .eq("job_id", inv.job_id);
    lineItems = (items ?? []).map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unitAmount: Number(it.unit_price),
      taxType: "OUTPUT2", // UK standard rate. Xero remaps if region differs.
      accountCode: DEFAULT_SALES_ACCOUNT_CODE,
    }));
  } else if (inv.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("scheduled_at, service:services(name)")
      .eq("id", inv.booking_id)
      .maybeSingle();
    type B = { scheduled_at: string; service: { name: string } | null };
    const b = booking as unknown as B | null;
    const serviceName = b?.service?.name ?? "Service";
    const when = b?.scheduled_at
      ? new Date(b.scheduled_at).toLocaleString("en-GB", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    // Booking total is gross; net = subtotal. Pass net as unitAmount and
    // tell Xero amounts are TaxExclusive so it adds VAT.
    lineItems = [
      {
        description: `${serviceName}${when ? ` — ${when}` : ""}`,
        quantity: 1,
        unitAmount: Number(inv.subtotal),
        taxType: "OUTPUT2",
        accountCode: DEFAULT_SALES_ACCOUNT_CODE,
      },
    ];
  } else {
    lineItems = [
      {
        description: `Invoice ${inv.invoice_number}`,
        quantity: 1,
        unitAmount: Number(inv.subtotal),
        taxType: "OUTPUT2",
        accountCode: DEFAULT_SALES_ACCOUNT_CODE,
      },
    ];
  }

  const xeroStatus: Invoice.StatusEnum =
    inv.status === "paid" || inv.status === "sent"
      ? Invoice.StatusEnum.AUTHORISED
      : Invoice.StatusEnum.DRAFT;

  const xeroInvoice: Invoice = {
    type: Invoice.TypeEnum.ACCREC,
    contact: { contactID: contactId },
    invoiceNumber: inv.invoice_number,
    reference: inv.booking_id ? `Booking ${inv.booking_id.slice(0, 8)}` : undefined,
    date: inv.issued_at,
    dueDate: inv.due_at,
    lineAmountTypes: LineAmountTypes.Exclusive,
    lineItems,
    status: xeroStatus,
  };

  try {
    const res = await conn.client.accountingApi.createInvoices(
      conn.tenantId,
      { invoices: [xeroInvoice] },
    );
    const created = res.body.invoices?.[0];
    if (!created?.invoiceID) return null;
    await admin
      .from("invoices")
      .update({
        xero_invoice_id: created.invoiceID,
        xero_synced_at: new Date().toISOString(),
      })
      .eq("id", invoiceId);
    console.log("[xero-sync] invoice pushed", {
      invoiceId,
      xeroInvoiceId: created.invoiceID,
    });
    return created.invoiceID;
  } catch (err) {
    console.error("[xero-sync] createInvoice failed", err);
    return null;
  }
}

// Push a Stripe payment to Xero against an existing invoice. Looks up
// the AI Garage invoice, ensures it has a xero_invoice_id (pushing first
// if missing), then records a Payment with the gross amount.
export async function pushPaymentToXero(args: {
  invoiceId: string;
  amountPence: number;
  paymentDate: string; // ISO
  reference?: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data: invoice } = await admin
    .from("invoices")
    .select(
      "id, xero_invoice_id, xero_payment_id, location:locations(organization_id)",
    )
    .eq("id", args.invoiceId)
    .maybeSingle();

  type InvRow = {
    id: string;
    xero_invoice_id: string | null;
    xero_payment_id: string | null;
    location: { organization_id: string } | null;
  };
  const inv = invoice as unknown as InvRow | null;
  if (!inv) return null;
  if (inv.xero_payment_id) return inv.xero_payment_id;
  const orgId = inv.location?.organization_id;
  if (!orgId) return null;

  // Push the invoice first if it hasn't been pushed yet.
  let xeroInvoiceId = inv.xero_invoice_id;
  if (!xeroInvoiceId) {
    xeroInvoiceId = await pushInvoiceToXero(args.invoiceId);
    if (!xeroInvoiceId) return null;
  }

  const conn = await getXeroClientForOrg(orgId);
  if (!conn) return null;

  // Find an account to post the payment to. Default to the first BANK
  // account on the connected org. Garages can move it later in Xero.
  let bankAccountId: string | null = null;
  try {
    const accountsRes = await conn.client.accountingApi.getAccounts(
      conn.tenantId,
      undefined,
      'Type=="BANK"',
    );
    bankAccountId = accountsRes.body.accounts?.[0]?.accountID ?? null;
  } catch (err) {
    console.error("[xero-sync] getAccounts failed", err);
  }
  if (!bankAccountId) {
    console.error("[xero-sync] no BANK account found in Xero");
    return null;
  }

  const payment: Payment = {
    invoice: { invoiceID: xeroInvoiceId },
    account: { accountID: bankAccountId },
    amount: args.amountPence / 100,
    date: args.paymentDate.split("T")[0],
    reference: args.reference,
  };

  try {
    const res = await conn.client.accountingApi.createPayment(
      conn.tenantId,
      payment,
    );
    const created = res.body.payments?.[0];
    if (!created?.paymentID) return null;
    await admin
      .from("invoices")
      .update({ xero_payment_id: created.paymentID })
      .eq("id", args.invoiceId);
    console.log("[xero-sync] payment pushed", {
      invoiceId: args.invoiceId,
      xeroPaymentId: created.paymentID,
    });
    return created.paymentID;
  } catch (err) {
    console.error("[xero-sync] createPayment failed", err);
    return null;
  }
}

// Push a Stripe payout to Xero as a Receive Money bank transaction.
// Idempotent on (organization_id, stripe_payout_id) so webhook retries
// or replays don't create duplicate bank transactions.
//
// Reconciliation flow on the garage side:
// - Customer pays invoice via Stripe → we already posted Payment in Xero
// - Stripe pays out net to garage's real bank → this function posts a
//   Receive Money bank transaction in Xero with the net amount and the
//   payout id as the reference, so the accountant can match it against
//   the bank feed line for the same amount + date.
// - Fees (gross payments minus payout net) accumulate as imbalance the
//   accountant resolves as a quarterly "Stripe fees" Spend Money — out
//   of scope for v1.
export async function pushPayoutToXero(args: {
  stripePayoutId: string;
  stripeAccountId: string;
  amountPence: number;
  arrivalDate: string; // YYYY-MM-DD
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id")
    .eq("stripe_account_id", args.stripeAccountId)
    .maybeSingle();
  if (!org) {
    console.log("[xero-sync] payout for unknown stripe account", args.stripeAccountId);
    return null;
  }

  // Idempotency check.
  const { data: existing } = await admin
    .from("xero_payouts")
    .select("xero_bank_transaction_id")
    .eq("organization_id", org.id)
    .eq("stripe_payout_id", args.stripePayoutId)
    .maybeSingle();
  if (existing) {
    console.log("[xero-sync] payout already pushed", {
      stripePayoutId: args.stripePayoutId,
      xeroBankTransactionId: existing.xero_bank_transaction_id,
    });
    return existing.xero_bank_transaction_id;
  }

  const conn = await getXeroClientForOrg(org.id);
  if (!conn) return null;

  // Pick the first BANK account on the connected org (same fallback as
  // pushPaymentToXero). A future setting can let the garage pick which
  // bank account receives payouts vs. clearing payments.
  let bankAccountId: string | null = null;
  let bankAccountCode: string | null = null;
  try {
    const accountsRes = await conn.client.accountingApi.getAccounts(
      conn.tenantId,
      undefined,
      'Type=="BANK"',
    );
    const account = accountsRes.body.accounts?.[0];
    bankAccountId = account?.accountID ?? null;
    bankAccountCode = account?.code ?? null;
  } catch (err) {
    console.error("[xero-sync] getAccounts failed", err);
  }
  if (!bankAccountId) {
    console.error("[xero-sync] no BANK account found for payout");
    return null;
  }

  // Receive Money bank transaction. Allocates to a generic "Sales" line
  // — accountant can recategorise later if they want a separate Stripe
  // payout account. We don't link line item to a specific revenue
  // account because the underlying Payment records already hit Sales.
  // Using a NOTAX line item keeps this transaction from double-counting
  // VAT (VAT was already accounted for on the original invoice).
  const txn: BankTransaction = {
    type: BankTransaction.TypeEnum.RECEIVE,
    contact: { name: "Stripe Payouts" },
    bankAccount: bankAccountCode
      ? { accountID: bankAccountId, code: bankAccountCode }
      : { accountID: bankAccountId },
    date: args.arrivalDate,
    reference: args.stripePayoutId,
    lineAmountTypes: LineAmountTypes.NoTax,
    lineItems: [
      {
        description: `Stripe payout ${args.stripePayoutId}`,
        quantity: 1,
        unitAmount: args.amountPence / 100,
        accountCode: DEFAULT_SALES_ACCOUNT_CODE,
        taxType: "NONE",
      },
    ],
  };

  try {
    const res = await conn.client.accountingApi.createBankTransactions(
      conn.tenantId,
      { bankTransactions: [txn] },
    );
    const created = res.body.bankTransactions?.[0];
    if (!created?.bankTransactionID) return null;

    await admin.from("xero_payouts").insert({
      organization_id: org.id,
      stripe_payout_id: args.stripePayoutId,
      stripe_account_id: args.stripeAccountId,
      xero_bank_transaction_id: created.bankTransactionID,
      amount_pence: args.amountPence,
      arrival_date: args.arrivalDate,
    });

    console.log("[xero-sync] payout pushed", {
      stripePayoutId: args.stripePayoutId,
      xeroBankTransactionId: created.bankTransactionID,
    });
    return created.bankTransactionID;
  } catch (err) {
    console.error("[xero-sync] createBankTransactions failed", err);
    return null;
  }
}
