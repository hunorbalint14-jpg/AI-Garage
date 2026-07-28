import { createAdminClient } from "@/lib/supabase/admin";
import { lineTreatmentOf, STANDARD_VAT_RATE, type VatTreatment } from "@/lib/vat";
import { isTenantAuthError, syncErrorMessage } from "./auth-errors";
import {
  clearReconnectEpisode,
  getAccountingConnection,
  markConnectionRevoked,
  PROVIDERS,
} from "./connection";
import type { AccountingConnection, LineTaxTreatment, SalesLine } from "./types";

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
  const message = args.error == null ? null : syncErrorMessage(args.error).slice(0, 500);
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

  if (args.status === "synced") {
    await clearReconnectEpisode(args.organizationId);
  } else if (isTenantAuthError(args.provider, args.error)) {
    // Tenant-level auth failure: the token refresh succeeded but the
    // provider rejects our API access (Xero Connected-Apps disconnect,
    // QBO/Sage revocation) — the refresh-path health check in
    // connection.ts never sees this, so open the reconnect episode here.
    await markConnectionRevoked({
      organizationId: args.organizationId,
      provider: args.provider,
      detail: message ?? "unknown error",
    });
  }
}

// Build the provider-neutral sales lines for an invoice. Pure — unit
// tested in sync.test.ts.
//
// `orgVatRegistered` = whether the org charges VAT at all. An unregistered
// org's lines all carry "no_vat"; a registered org's lines carry their
// stored treatment — zero-rated / exempt / outside-scope are DISTINCT
// provider codes (Box 6 of the VAT return includes zero-rated and exempt
// sales but not outside-scope ones, so collapsing them misstates the
// return the garage files from the accounting package).
export function buildSalesLines(args: {
  orgVatRegistered: boolean;
  jobItems: { description: string; quantity: number; unit_price: number; vat_rate?: number | null; vat_treatment?: string | null }[] | null;
  consolidated: { description: string; net: number; taxTreatment: VatTreatment }[] | null;
  booking: { serviceName: string; when: string | null; subtotal: number; taxTreatment: VatTreatment } | null;
  fallback: { invoiceNumber: string; subtotal: number };
  membershipCredit: { amount: number; description: string | null };
  discount: { amount: number; description: string | null };
}): SalesLine[] {
  const treat = (t: VatTreatment): LineTaxTreatment => (args.orgVatRegistered ? t : "no_vat");
  const lines: SalesLine[] = [];

  if (args.jobItems && args.jobItems.length > 0) {
    for (const it of args.jobItems) {
      lines.push({
        description: it.description,
        quantity: Number(it.quantity),
        unitAmount: Number(it.unit_price),
        taxTreatment: treat(lineTreatmentOf(it.vat_treatment, it.vat_rate)),
      });
    }
  } else if (args.consolidated && args.consolidated.length > 0) {
    // Consolidated account invoice (#504): a line per member job (split
    // per treatment when a job mixes rates) so the provider's VAT matches
    // the per-line VAT summed at raise time.
    for (const c of args.consolidated) {
      lines.push({
        description: c.description,
        quantity: 1,
        unitAmount: Number(c.net),
        taxTreatment: treat(c.taxTreatment),
      });
    }
  } else if (args.booking) {
    // Booking total is gross; net = subtotal. We pass net and the
    // provider is told amounts are tax-exclusive so it adds VAT.
    lines.push({
      description: `${args.booking.serviceName}${args.booking.when ? ` — ${args.booking.when}` : ""}`,
      quantity: 1,
      unitAmount: Number(args.booking.subtotal),
      taxTreatment: treat(args.booking.taxTreatment),
    });
  } else {
    lines.push({
      description: `Invoice ${args.fallback.invoiceNumber}`,
      quantity: 1,
      unitAmount: Number(args.fallback.subtotal),
      taxTreatment: treat("standard"),
    });
  }

  // Deductions carry the invoice's dominant treatment — standard when any
  // standard-rated line exists (so the provider's VAT lands on the same
  // discounted net we charged), otherwise the first line's treatment (a
  // credit against an all-0% invoice must not subtract VAT nothing added).
  // NOTE: on a mixed-rate invoice with deductions, our pro-rata VAT and
  // the provider's per-line VAT can differ by pennies — acceptable.
  const deductionTreatment: LineTaxTreatment = lines.some((l) => l.taxTreatment === "standard")
    ? "standard"
    : lines[0]?.taxTreatment ?? treat("standard");

  // Membership credit (covered included services) as a single negative line.
  if (Number(args.membershipCredit.amount) > 0) {
    lines.push({
      description: args.membershipCredit.description ?? "Included in membership",
      quantity: 1,
      unitAmount: -Number(args.membershipCredit.amount),
      taxTreatment: deductionTreatment,
    });
  }

  // Member discount as a single negative line. Works for both percent +
  // fixed discounts without parsing the type.
  if (Number(args.discount.amount) > 0) {
    lines.push({
      description: args.discount.description ?? "Member discount",
      quantity: 1,
      unitAmount: -Number(args.discount.amount),
      taxTreatment: deductionTreatment,
    });
  }

  return lines;
}

// Credit-note lines carrying the refund's actual VAT mix. The credit note
// stores net + VAT split at the invoice's blended rate; reconstruct the
// standard-rated portion (VAT ÷ 20%) and put any remainder on a no-VAT
// line, so a refund against a 0%-VAT invoice (MOT fee, unregistered org)
// doesn't gain 20% provider-side. Pure — unit tested in sync.test.ts.
export function buildCreditNoteLines(args: {
  description: string;
  subtotal: number; // net, positive
  vatAmount: number;
  orgVatRegistered: boolean;
}): SalesLine[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const net = round2(Number(args.subtotal) || 0);
  const vat = round2(Number(args.vatAmount) || 0);

  if (!args.orgVatRegistered || vat <= 0) {
    // No treatment survives on the stored credit note — outside_scope keeps
    // the provider's no-VAT code (matching the historic behaviour) rather
    // than guessing a Box 6 change.
    return [
      {
        description: args.description,
        quantity: 1,
        unitAmount: net,
        taxTreatment: args.orgVatRegistered ? "outside_scope" : "no_vat",
      },
    ];
  }

  const standardNet = round2(vat / (STANDARD_VAT_RATE / 100));
  if (standardNet >= net - 0.01) {
    return [{ description: args.description, quantity: 1, unitAmount: net, taxTreatment: "standard" }];
  }
  return [
    { description: args.description, quantity: 1, unitAmount: standardNet, taxTreatment: "standard" },
    {
      description: `${args.description} — no-VAT portion`,
      quantity: 1,
      unitAmount: round2(net - standardNet),
      taxTreatment: "outside_scope",
    },
  ];
}

export async function orgIsVatRegistered(organizationId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("organizations")
    .select("vat_registered")
    .eq("id", organizationId)
    .maybeSingle();
  return (data as { vat_registered: boolean | null } | null)?.vat_registered !== false;
}

const TREATMENT_SUFFIX: Record<VatTreatment, string> = {
  standard: "standard-rated",
  zero: "zero-rated",
  exempt: "VAT exempt",
  outside_scope: "outside scope",
};

// Lines for a consolidated account invoice (#504): one line per member
// job, split per treatment when a job mixes rates, so the provider's VAT
// matches the per-line VAT this invoice summed at raise time (the old
// single-fallback-line push marked the whole subtotal standard-rated —
// wrong VAT and total for mixed-VAT consolidations).
async function consolidatedSalesLines(
  invoiceId: string,
): Promise<{ description: string; net: number; taxTreatment: VatTreatment }[] | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("invoice_jobs")
    .select(
      "amount, job:jobs(id, description, completed_at, vehicle:vehicles(registration), items:job_items(quantity, unit_price, vat_rate, vat_treatment))",
    )
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });
  type Row = {
    amount: number;
    job: {
      id: string;
      description: string | null;
      completed_at: string | null;
      vehicle: { registration: string | null } | null;
      items: { quantity: number; unit_price: number; vat_rate: number | null; vat_treatment: string | null }[] | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return null;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const out: { description: string; net: number; taxTreatment: VatTreatment }[] = [];
  for (const r of rows) {
    const date = r.job?.completed_at
      ? new Date(r.job.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      : null;
    const label = [date, r.job?.vehicle?.registration, r.job?.description?.trim() || "Workshop job"]
      .filter(Boolean)
      .join(" · ");

    const byTreatment = new Map<VatTreatment, number>();
    for (const it of r.job?.items ?? []) {
      const t = lineTreatmentOf(it.vat_treatment, it.vat_rate);
      byTreatment.set(t, (byTreatment.get(t) ?? 0) + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0));
    }
    if (byTreatment.size === 0) {
      // No surviving job lines — fall back to the stored per-job amount.
      out.push({ description: label, net: Number(r.amount), taxTreatment: "standard" });
      continue;
    }
    for (const [t, net] of byTreatment) {
      out.push({
        description: byTreatment.size > 1 ? `${label} — ${TREATMENT_SUFFIX[t]}` : label,
        net: round2(net),
        taxTreatment: t,
      });
    }
  }
  return out;
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

// The exact sales lines the provider push sends, derivable for any
// invoice row — shared by pushInvoiceToAccounting and the
// accounting-import CSV export (the export IS the digital-link fallback,
// so it must say precisely what the API sync would have said).
export async function salesLinesForInvoiceRow(
  inv: Pick<
    InvoiceRow,
    | "id"
    | "job_id"
    | "booking_id"
    | "invoice_number"
    | "subtotal"
    | "vat_amount"
    | "discount_amount"
    | "discount_description"
    | "membership_credit_amount"
    | "membership_credit_description"
  >,
  orgVatRegistered: boolean,
): Promise<SalesLine[]> {
  const admin = createAdminClient();

  type JobItemRow = { description: string; quantity: number; unit_price: number; vat_rate?: number | null; vat_treatment?: string | null };
  let jobItems: JobItemRow[] | null = null;
  let booking: { serviceName: string; when: string | null; subtotal: number; taxTreatment: VatTreatment } | null = null;
  let consolidated: { description: string; net: number; taxTreatment: VatTreatment }[] | null = null;
  if (inv.job_id) {
    const { data: items } = await admin
      .from("job_items")
      .select("description, type, quantity, unit_price, vat_rate, vat_treatment")
      .eq("job_id", inv.job_id);
    jobItems = (items ?? []) as unknown as JobItemRow[];
  } else if (inv.booking_id) {
    const { data: b } = await admin
      .from("bookings")
      .select("scheduled_at, service:services(name, vat_treatment)")
      .eq("id", inv.booking_id)
      .maybeSingle();
    type B = { scheduled_at: string; service: { name: string; vat_treatment: string | null } | null };
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
      // The booking invoice's stored VAT was derived from this treatment
      // at generation time; vat_rate > 0 on the invoice implies standard.
      taxTreatment: lineTreatmentOf(row?.service?.vat_treatment, Number(inv.vat_amount) > 0 ? STANDARD_VAT_RATE : 0),
    };
  } else {
    consolidated = await consolidatedSalesLines(inv.id);
  }

  return buildSalesLines({
    orgVatRegistered,
    jobItems,
    consolidated,
    booking,
    fallback: { invoiceNumber: inv.invoice_number, subtotal: Number(inv.subtotal) },
    membershipCredit: {
      amount: Number(inv.membership_credit_amount),
      description: inv.membership_credit_description,
    },
    discount: { amount: Number(inv.discount_amount), description: inv.discount_description },
  });
}

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
    const orgVatRegistered = await orgIsVatRegistered(inv.organization_id);

    const payload = {
      ourInvoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      referenceTag: `AIG-${inv.id}`,
      issuedAt: inv.issued_at,
      dueAt: inv.due_at,
      contactExternalId,
      lines: await salesLinesForInvoiceRow(inv, orgVatRegistered),
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

// Push one account-payment allocation (#504) as a provider payment against
// its invoice. Account payments allocate one cash receipt across several
// invoices, so idempotency lives on payment_allocations.accounting_payment_id
// (per allocation), not the invoice's single accounting_payment_id — that
// column is stamped only once the invoice is fully paid and every allocation
// has synced, which keeps the books-health counts and the full-payment
// retry path honest.
export async function pushAllocationToAccounting(allocationId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("payment_allocations")
    .select(
      "id, amount, accounting_payment_id, invoice_id, payment:payments(id, organization_id, method, reference, received_at)",
    )
    .eq("id", allocationId)
    .maybeSingle();
  type Row = {
    id: string;
    amount: number;
    accounting_payment_id: string | null;
    invoice_id: string;
    payment: { id: string; organization_id: string; method: string | null; reference: string | null; received_at: string | null } | null;
  };
  const alloc = data as unknown as Row | null;
  if (!alloc?.payment) return null;
  if (alloc.accounting_payment_id) return alloc.accounting_payment_id;
  const orgId = alloc.payment.organization_id;

  const { data: invData } = await admin
    .from("invoices")
    .select("id, organization_id, customer_id, total, amount_paid, accounting_invoice_id, accounting_payment_id, is_demo")
    .eq("id", alloc.invoice_id)
    .maybeSingle();
  type Inv = {
    id: string;
    organization_id: string | null;
    customer_id: string;
    total: number;
    amount_paid: number | null;
    accounting_invoice_id: string | null;
    accounting_payment_id: string | null;
    is_demo: boolean | null;
  };
  const inv = invData as Inv | null;
  if (!inv || inv.is_demo) return null;

  let externalInvoiceId = inv.accounting_invoice_id;
  if (!externalInvoiceId) {
    externalInvoiceId = await pushInvoiceToAccounting(inv.id);
    if (!externalInvoiceId) return null;
  }

  const conn = await getAccountingConnection(orgId);
  if (!conn) return null;

  try {
    const contactExternalId = await ensureContactForCustomer(conn, inv.customer_id);
    const externalId = await PROVIDERS[conn.provider].createPayment(conn, {
      externalInvoiceId,
      contactExternalId,
      amount: Number(alloc.amount),
      dateISO: alloc.payment.received_at ?? new Date().toISOString(),
      reference:
        alloc.payment.reference ?? `Account payment (${alloc.payment.method ?? "manual"})`,
    });
    await admin
      .from("payment_allocations")
      .update({ accounting_payment_id: externalId })
      .eq("id", allocationId);

    // Fully paid + every allocation synced → stamp the invoice's own
    // mapping column so health/retry treat the payment side as complete.
    if (!inv.accounting_payment_id) {
      const { count } = await admin
        .from("payment_allocations")
        .select("id", { count: "exact", head: true })
        .eq("invoice_id", inv.id)
        .is("accounting_payment_id", null);
      const { data: invNow } = await admin
        .from("invoices")
        .select("status, accounting_payment_id")
        .eq("id", inv.id)
        .maybeSingle();
      const nowRow = invNow as { status: string; accounting_payment_id: string | null } | null;
      if ((count ?? 0) === 0 && nowRow && !nowRow.accounting_payment_id && nowRow.status === "paid") {
        await admin.from("invoices").update({ accounting_payment_id: externalId }).eq("id", inv.id);
      }
    }

    await logSync({
      organizationId: orgId,
      provider: conn.provider,
      entityType: "payment",
      entityId: inv.id,
      externalId,
      status: "synced",
    });
    console.log("[accounting] allocation pushed", { allocationId, invoiceId: inv.id, provider: conn.provider, externalId });
    return externalId;
  } catch (err) {
    console.error("[accounting] allocation push failed", { allocationId, provider: conn.provider }, err);
    await logSync({
      organizationId: orgId,
      provider: conn.provider,
      entityType: "payment",
      entityId: inv.id,
      status: "failed",
      error: err,
    });
    return null;
  }
}

// Void the provider-side invoice after a local delete — otherwise an
// authorised sales invoice lives on in the package with no local
// counterpart (an orphan the accountant must find by hand). Best-effort:
// failure is logged so the orphan is visible in books health.
export async function voidInvoiceInAccounting(args: {
  organizationId: string;
  externalInvoiceId: string;
  invoiceId?: string;
}): Promise<boolean> {
  const conn = await getAccountingConnection(args.organizationId);
  if (!conn) return false;
  try {
    await PROVIDERS[conn.provider].voidInvoice(conn, args.externalInvoiceId);
    await logSync({
      organizationId: args.organizationId,
      provider: conn.provider,
      entityType: "invoice",
      entityId: args.invoiceId ?? null,
      externalId: args.externalInvoiceId,
      status: "synced",
    });
    console.log("[accounting] provider invoice voided", {
      externalInvoiceId: args.externalInvoiceId,
      provider: conn.provider,
    });
    return true;
  } catch (err) {
    console.error("[accounting] provider invoice void failed", { externalInvoiceId: args.externalInvoiceId }, err);
    await logSync({
      organizationId: args.organizationId,
      provider: conn.provider,
      entityType: "invoice",
      entityId: args.invoiceId ?? null,
      externalId: args.externalInvoiceId,
      status: "failed",
      error: new Error(`void failed — orphaned invoice in ${conn.provider}: ${syncErrorMessage(err)}`),
    });
    return false;
  }
}

// Push a credit note (a refund) to the provider. Idempotent via the local
// mapping column, then the provider-side dedupe key.
export async function pushCreditNoteToAccounting(creditNoteId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("credit_notes")
    .select("id, organization_id, customer_id, credit_number, reason, subtotal, vat_amount, accounting_credit_note_id")
    .eq("id", creditNoteId)
    .maybeSingle();
  type Row = {
    id: string;
    organization_id: string | null;
    customer_id: string | null;
    credit_number: string | null;
    reason: string | null;
    subtotal: number;
    vat_amount: number | null;
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
    const orgVatRegistered = await orgIsVatRegistered(cn.organization_id);
    const payload = {
      ourCreditNoteId: cn.id,
      referenceTag: `AIG-CN-${cn.id}`,
      creditNumber: cn.credit_number,
      contactExternalId,
      lines: buildCreditNoteLines({
        description: cn.reason
          ? `Refund — ${cn.reason}`
          : `Refund ${cn.credit_number ?? ""}`.trim(),
        subtotal: Number(cn.subtotal),
        vatAmount: Number(cn.vat_amount ?? 0),
        orgVatRegistered,
      }),
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
