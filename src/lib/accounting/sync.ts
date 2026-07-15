import { createAdminClient } from "@/lib/supabase/admin";
import { getAccountingConnection, PROVIDERS } from "./connection";
import type { AccountingConnection, SalesLine } from "./types";

// Provider-neutral sync orchestration (#501). Owns: loading our rows,
// building payloads, idempotency (accounting_* mapping columns +
// provider-side reference lookups), and the accounting_sync_log rows the
// books-health panel reads. All entry points are best-effort — they log
// and return null rather than throw, so fire-and-forget callers (server
// actions, webhooks) never break the user-facing flow on a sync failure.

type SyncEntity = "invoice" | "payment" | "credit_note" | "payout" | "contact";

async function logSync(args: {
  organizationId: string;
  provider: string;
  entityType: SyncEntity;
  entityId?: string | null;
  externalId?: string | null;
  status: "synced" | "failed";
  error?: unknown;
}): Promise<void> {
  const admin = createAdminClient();
  const message =
    args.error == null
      ? null
      : (args.error instanceof Error ? args.error.message : String(args.error)).slice(0, 500);
  const { error } = await admin.from("accounting_sync_log").insert({
    organization_id: args.organizationId,
    provider: args.provider,
    entity_type: args.entityType,
    entity_id: args.entityId ?? null,
    external_id: args.externalId ?? null,
    status: args.status,
    error: message,
  });
  if (error) console.error("[accounting] sync log write failed", error.message);
}

// Build the provider-neutral sales lines for an invoice. Pure — unit
// tested in sync.test.ts.
//
// `invoiceHasVat` = whether the invoice carries VAT at all (unregistered
// org / all lines zero-rated → no VAT anywhere so the provider's total
// matches ours). Per-line: standard-rated lines get the provider's UK 20%
// code; an MOT fee or other 0% line gets its no-VAT code.
export function buildSalesLines(args: {
  invoiceHasVat: boolean;
  jobItems: { description: string; quantity: number; unit_price: number; vat_rate?: number | null }[] | null;
  booking: { serviceName: string; when: string | null; subtotal: number } | null;
  fallback: { invoiceNumber: string; subtotal: number };
  membershipCredit: { amount: number; description: string | null };
  discount: { amount: number; description: string | null };
}): SalesLine[] {
  const lines: SalesLine[] = [];

  if (args.jobItems && args.jobItems.length > 0) {
    for (const it of args.jobItems) {
      lines.push({
        description: it.description,
        quantity: Number(it.quantity),
        unitAmount: Number(it.unit_price),
        standardRated: args.invoiceHasVat && Number(it.vat_rate ?? 20) > 0,
      });
    }
  } else if (args.booking) {
    // Booking total is gross; net = subtotal. We pass net and the
    // provider is told amounts are tax-exclusive so it adds VAT.
    lines.push({
      description: `${args.booking.serviceName}${args.booking.when ? ` — ${args.booking.when}` : ""}`,
      quantity: 1,
      unitAmount: Number(args.booking.subtotal),
      standardRated: args.invoiceHasVat,
    });
  } else {
    lines.push({
      description: `Invoice ${args.fallback.invoiceNumber}`,
      quantity: 1,
      unitAmount: Number(args.fallback.subtotal),
      standardRated: args.invoiceHasVat,
    });
  }

  // Membership credit (covered included services): a single negative
  // standard-rated line so the provider's VAT lands on the same net we
  // charged.
  if (Number(args.membershipCredit.amount) > 0) {
    lines.push({
      description: args.membershipCredit.description ?? "Included in membership",
      quantity: 1,
      unitAmount: -Number(args.membershipCredit.amount),
      standardRated: args.invoiceHasVat,
    });
  }

  // Member discount as a single negative line (same tax treatment so the
  // provider's VAT lands on the discounted net, matching our stored
  // total). Works for both percent + fixed discounts without parsing the
  // type. NOTE: on a mixed-rate invoice with deductions, our pro-rata VAT
  // and the provider's per-line VAT can differ by pennies — acceptable,
  // and only when a discounted invoice mixes standard + non-standard lines.
  if (Number(args.discount.amount) > 0) {
    lines.push({
      description: args.discount.description ?? "Member discount",
      quantity: 1,
      unitAmount: -Number(args.discount.amount),
      standardRated: args.invoiceHasVat,
    });
  }

  return lines;
}

// Returns the provider-side contact id for a customer, creating the
// contact on first call and persisting the mapping.
async function ensureContactForCustomer(
  conn: AccountingConnection,
  customerId: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone, accounting_contact_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!customer) throw new Error(`customer ${customerId} not found`);
  if (customer.accounting_contact_id) return customer.accounting_contact_id as string;

  const externalId = await PROVIDERS[conn.provider].ensureContact(conn, {
    name: (customer.full_name as string | null) ?? (customer.email as string | null) ?? "Customer",
    email: customer.email as string | null,
    phone: customer.phone as string | null,
  });
  await admin
    .from("customers")
    .update({ accounting_contact_id: externalId })
    .eq("id", customerId);
  return externalId;
}

type InvoiceRow = {
  id: string;
  organization_id: string | null;
  customer_id: string;
  job_id: string | null;
  booking_id: string | null;
  invoice_number: string;
  subtotal: number;
  vat_amount: number;
  discount_amount: number;
  discount_description: string | null;
  membership_credit_amount: number;
  membership_credit_description: string | null;
  issued_at: string;
  due_at: string;
  accounting_invoice_id: string | null;
  is_demo: boolean | null;
};

// Push an invoice (with its job_items OR booking line) to the org's
// connected accounting provider as a sales invoice. Idempotent: local
// mapping column first, then a provider-side reference lookup. Returns
// the provider's invoice id on success.
export async function pushInvoiceToAccounting(invoiceId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select(
      "id, organization_id, customer_id, job_id, booking_id, invoice_number, subtotal, vat_amount, discount_amount, discount_description, membership_credit_amount, membership_credit_description, issued_at, due_at, accounting_invoice_id, is_demo",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  const inv = data as unknown as InvoiceRow | null;
  if (!inv) return null;
  // Sandbox invoices never reach the accounts (#506).
  if (inv.is_demo) return null;
  if (inv.accounting_invoice_id) return inv.accounting_invoice_id;
  if (!inv.organization_id) return null;

  const conn = await getAccountingConnection(inv.organization_id);
  if (!conn) return null; // not connected — not a failure
  const provider = PROVIDERS[conn.provider];

  try {
    const contactExternalId = await ensureContactForCustomer(conn, inv.customer_id);

    const invoiceHasVat = Number(inv.vat_amount) > 0;
    type JobItemRow = { description: string; quantity: number; unit_price: number; vat_rate?: number | null };
    let jobItems: JobItemRow[] | null = null;
    let booking: { serviceName: string; when: string | null; subtotal: number } | null = null;
    if (inv.job_id) {
      const { data: items } = await admin
        .from("job_items")
        .select("description, type, quantity, unit_price, vat_rate")
        .eq("job_id", inv.job_id);
      jobItems = (items ?? []) as unknown as JobItemRow[];
    } else if (inv.booking_id) {
      const { data: b } = await admin
        .from("bookings")
        .select("scheduled_at, service:services(name)")
        .eq("id", inv.booking_id)
        .maybeSingle();
      type B = { scheduled_at: string; service: { name: string } | null };
      const row = b as unknown as B | null;
      booking = {
        serviceName: row?.service?.name ?? "Service",
        when: row?.scheduled_at
          ? new Date(row.scheduled_at).toLocaleString("en-GB", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })
          : null,
        subtotal: Number(inv.subtotal),
      };
    }

    const payload = {
      ourInvoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      referenceTag: `AIG-${inv.id}`,
      issuedAt: inv.issued_at,
      dueAt: inv.due_at,
      contactExternalId,
      lines: buildSalesLines({
        invoiceHasVat,
        jobItems,
        booking,
        fallback: { invoiceNumber: inv.invoice_number, subtotal: Number(inv.subtotal) },
        membershipCredit: {
          amount: Number(inv.membership_credit_amount),
          description: inv.membership_credit_description,
        },
        discount: { amount: Number(inv.discount_amount), description: inv.discount_description },
      }),
    };

    // Provider-side dedupe recovers a lost local mapping (and on Xero
    // also re-promotes DRAFT rows so payments can attach).
    let externalId = await provider.findInvoice(conn, payload);
    const reused = !!externalId;
    if (!externalId) externalId = await provider.createInvoice(conn, payload);

    await admin
      .from("invoices")
      .update({ accounting_invoice_id: externalId, accounting_synced_at: new Date().toISOString() })
      .eq("id", invoiceId);
    await logSync({
      organizationId: inv.organization_id,
      provider: conn.provider,
      entityType: "invoice",
      entityId: invoiceId,
      externalId,
      status: "synced",
    });
    console.log(`[accounting] invoice ${reused ? "matched" : "pushed"}`, {
      invoiceId,
      provider: conn.provider,
      externalId,
    });
    return externalId;
  } catch (err) {
    console.error("[accounting] invoice push failed", { invoiceId, provider: conn.provider }, err);
    await logSync({
      organizationId: inv.organization_id,
      provider: conn.provider,
      entityType: "invoice",
      entityId: invoiceId,
      status: "failed",
      error: err,
    });
    return null;
  }
}

// Record a payment against an already-pushed invoice (pushing the invoice
// first if needed). Gross amount, in pence.
export async function pushPaymentToAccounting(args: {
  invoiceId: string;
  amountPence: number;
  paymentDate: string; // ISO
  reference?: string;
}): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoices")
    .select("id, organization_id, customer_id, accounting_invoice_id, accounting_payment_id, is_demo")
    .eq("id", args.invoiceId)
    .maybeSingle();
  type Row = {
    id: string;
    organization_id: string | null;
    customer_id: string;
    accounting_invoice_id: string | null;
    accounting_payment_id: string | null;
    is_demo: boolean | null;
  };
  const inv = data as Row | null;
  if (!inv || inv.is_demo) return null;
  if (inv.accounting_payment_id) return inv.accounting_payment_id;
  if (!inv.organization_id) return null;

  let externalInvoiceId = inv.accounting_invoice_id;
  if (!externalInvoiceId) {
    externalInvoiceId = await pushInvoiceToAccounting(args.invoiceId);
    if (!externalInvoiceId) return null;
  }

  const conn = await getAccountingConnection(inv.organization_id);
  if (!conn) return null;

  try {
    // QuickBooks payments need CustomerRef; the mapping exists by now
    // because the invoice push created the contact.
    const contactExternalId = await ensureContactForCustomer(conn, inv.customer_id);
    const externalId = await PROVIDERS[conn.provider].createPayment(conn, {
      externalInvoiceId,
      contactExternalId,
      amount: args.amountPence / 100,
      dateISO: args.paymentDate,
      reference: args.reference,
    });
    await admin
      .from("invoices")
      .update({ accounting_payment_id: externalId })
      .eq("id", args.invoiceId);
    await logSync({
      organizationId: inv.organization_id,
      provider: conn.provider,
      entityType: "payment",
      entityId: args.invoiceId,
      externalId,
      status: "synced",
    });
    console.log("[accounting] payment pushed", { invoiceId: args.invoiceId, provider: conn.provider, externalId });
    return externalId;
  } catch (err) {
    console.error("[accounting] payment push failed", { invoiceId: args.invoiceId, provider: conn.provider }, err);
    await logSync({
      organizationId: inv.organization_id,
      provider: conn.provider,
      entityType: "payment",
      entityId: args.invoiceId,
      status: "failed",
      error: err,
    });
    return null;
  }
}

// Push a credit note (a refund) to the provider. Idempotent via the local
// mapping column, then the provider-side dedupe key.
export async function pushCreditNoteToAccounting(creditNoteId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_notes")
    .select("id, organization_id, customer_id, credit_number, reason, subtotal, accounting_credit_note_id")
    .eq("id", creditNoteId)
    .maybeSingle();
  type Row = {
    id: string;
    organization_id: string | null;
    customer_id: string | null;
    credit_number: string | null;
    reason: string | null;
    subtotal: number;
    accounting_credit_note_id: string | null;
  };
  const cn = data as Row | null;
  if (!cn) return null;
  if (cn.accounting_credit_note_id) return cn.accounting_credit_note_id;
  if (!cn.customer_id || !cn.organization_id) return null;

  const conn = await getAccountingConnection(cn.organization_id);
  if (!conn) return null;
  const provider = PROVIDERS[conn.provider];

  try {
    const contactExternalId = await ensureContactForCustomer(conn, cn.customer_id);
    const payload = {
      ourCreditNoteId: cn.id,
      referenceTag: `AIG-CN-${cn.id}`,
      creditNumber: cn.credit_number,
      contactExternalId,
      description: cn.reason
        ? `Refund — ${cn.reason}`
        : `Refund ${cn.credit_number ?? ""}`.trim(),
      amount: Number(cn.subtotal),
    };

    let externalId = await provider.findCreditNote(conn, payload);
    if (!externalId) externalId = await provider.createCreditNote(conn, payload);

    await admin
      .from("credit_notes")
      .update({ accounting_credit_note_id: externalId, status: "synced" })
      .eq("id", creditNoteId);
    await logSync({
      organizationId: cn.organization_id,
      provider: conn.provider,
      entityType: "credit_note",
      entityId: creditNoteId,
      externalId,
      status: "synced",
    });
    console.log("[accounting] credit note pushed", { creditNoteId, provider: conn.provider, externalId });
    return externalId;
  } catch (err) {
    console.error("[accounting] credit note push failed", { creditNoteId, provider: conn.provider }, err);
    await logSync({
      organizationId: cn.organization_id,
      provider: conn.provider,
      entityType: "credit_note",
      entityId: creditNoteId,
      status: "failed",
      error: err,
    });
    return null;
  }
}

// Push a Stripe payout as a bank-side transaction (Xero: Receive Money;
// QuickBooks: Deposit). Idempotent on (organization_id, stripe_payout_id)
// via accounting_payouts so webhook retries don't duplicate.
//
// Reconciliation flow on the garage side: the customer's card payment was
// already recorded against the invoice; when Stripe pays out net to the
// garage's real bank, this posts a matching transaction the accountant
// can tick off against the bank feed line (same amount + date).
export async function pushPayoutToAccounting(args: {
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
    console.log("[accounting] payout for unknown stripe account", args.stripeAccountId);
    return null;
  }

  const { data: existing } = await admin
    .from("accounting_payouts")
    .select("external_transaction_id")
    .eq("organization_id", org.id)
    .eq("stripe_payout_id", args.stripePayoutId)
    .maybeSingle();
  if (existing) {
    console.log("[accounting] payout already pushed", {
      stripePayoutId: args.stripePayoutId,
      externalTransactionId: existing.external_transaction_id,
    });
    return existing.external_transaction_id as string | null;
  }

  const conn = await getAccountingConnection(org.id);
  if (!conn) return null;

  try {
    const externalId = await PROVIDERS[conn.provider].createPayout(conn, {
      reference: args.stripePayoutId,
      amount: args.amountPence / 100,
      date: args.arrivalDate,
    });

    await admin.from("accounting_payouts").insert({
      organization_id: org.id,
      provider: conn.provider,
      stripe_payout_id: args.stripePayoutId,
      stripe_account_id: args.stripeAccountId,
      external_transaction_id: externalId,
      amount_pence: args.amountPence,
      arrival_date: args.arrivalDate,
    });
    await logSync({
      organizationId: org.id,
      provider: conn.provider,
      entityType: "payout",
      externalId,
      status: "synced",
    });
    console.log("[accounting] payout pushed", {
      stripePayoutId: args.stripePayoutId,
      provider: conn.provider,
      externalId,
    });
    return externalId;
  } catch (err) {
    console.error("[accounting] payout push failed", { stripePayoutId: args.stripePayoutId, provider: conn.provider }, err);
    await logSync({
      organizationId: org.id,
      provider: conn.provider,
      entityType: "payout",
      status: "failed",
      error: err,
    });
    return null;
  }
}
