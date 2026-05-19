import { Contact, Invoice, LineAmountTypes, LineItem, Payment, Phone } from "xero-node";
import { createAdminClient } from "@/lib/supabase/admin";
import { getXeroClientForOrg } from "@/lib/xero";

// Idempotent helper: returns the Xero ContactID for a customer, creating
// the Xero contact on first call.
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

  const contact: Contact = {
    name: customer.full_name ?? customer.email ?? "Customer",
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
      },
    ];
  } else {
    lineItems = [
      {
        description: `Invoice ${inv.invoice_number}`,
        quantity: 1,
        unitAmount: Number(inv.subtotal),
        taxType: "OUTPUT2",
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
