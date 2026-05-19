import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { buildInvoiceHtml } from "@/lib/invoice-html";
import { pushInvoiceToXero, pushPaymentToXero } from "@/lib/xero-sync";

type GenerateArgs = {
  bookingId: string;
  amountPence: number;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
};

// Called from the Stripe webhook after a booking payment succeeds. Inserts
// a paid invoice row tied to the booking, then sends the branded invoice
// email to the customer. Idempotent: if an invoice already exists for this
// booking the function exits silently.
export async function generateInvoiceForPaidBooking({
  bookingId,
  amountPence,
  stripePaymentIntentId,
  stripeCheckoutSessionId,
}: GenerateArgs): Promise<void> {
  const admin = createAdminClient();

  // Idempotency: skip if an invoice for this booking already exists.
  const { data: existing } = await admin
    .from("invoices")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (existing) {
    console.log("[booking-invoice] invoice already exists for booking", bookingId);
    return;
  }

  const { data: bookingRow } = await admin
    .from("bookings")
    .select(
      "id, location_id, customer_id, scheduled_at, notes, service:services(name, category), customer:customers(full_name, email), location:locations(name, organization:organizations(id, name, phone, logo_url, primary_color))",
    )
    .eq("id", bookingId)
    .maybeSingle();

  type BookingRow = {
    id: string;
    location_id: string;
    customer_id: string;
    scheduled_at: string;
    notes: string | null;
    service: { name: string; category: string } | null;
    customer: { full_name: string | null; email: string | null } | null;
    location: {
      name: string;
      organization: {
        id: string;
        name: string;
        phone: string | null;
        logo_url: string | null;
        primary_color: string | null;
      } | null;
    } | null;
  };
  const booking = bookingRow as unknown as BookingRow | null;
  if (!booking) {
    console.error("[booking-invoice] booking not found", bookingId);
    return;
  }

  const customerEmail = booking.customer?.email ?? null;
  if (!customerEmail) {
    console.error("[booking-invoice] customer has no email", bookingId);
    // Still create the invoice so the garage has the record; just skip email.
  }

  // UK GBP, gross-of-VAT. Stripe collected the total at checkout, so we
  // back-calculate the net (subtotal) at the standard 20% VAT rate so the
  // invoice line splits sensibly.
  const total = Math.round(amountPence) / 100;
  const vatRate = 20;
  const subtotal = +(total / (1 + vatRate / 100)).toFixed(2);
  const vatAmount = +(total - subtotal).toFixed(2);

  // Generate invoice number scoped to the location.
  const { count } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("location_id", booking.location_id);
  const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
  const today = new Date();

  const { data: invoice, error: insertErr } = await admin
    .from("invoices")
    .insert({
      location_id: booking.location_id,
      customer_id: booking.customer_id,
      job_id: null,
      booking_id: booking.id,
      invoice_number: invoiceNumber,
      subtotal,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total,
      issued_at: today.toISOString().split("T")[0],
      due_at: today.toISOString().split("T")[0],
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_paid_at: new Date().toISOString(),
      stripe_paid_amount_pence: amountPence,
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_checkout_session_id: stripeCheckoutSessionId,
    })
    .select("id")
    .single();

  if (insertErr || !invoice) {
    console.error("[booking-invoice] insert failed", insertErr?.message);
    return;
  }

  console.log("[booking-invoice] invoice created", {
    invoiceId: invoice.id,
    invoiceNumber,
    bookingId,
  });

  if (!customerEmail) return;

  const org = booking.location?.organization;
  const garageName = org?.name ?? booking.location?.name ?? "the garage";
  const dateStr = new Date(booking.scheduled_at).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  const serviceName = booking.service?.name ?? "Service";

  const html = buildInvoiceHtml({
    invoiceNumber,
    issuedAt: today.toISOString().split("T")[0],
    dueAt: today.toISOString().split("T")[0],
    garageName,
    garagePhone: org?.phone ?? null,
    garageEmail: null,
    logoUrl: org?.logo_url ?? null,
    brandColor: org?.primary_color ?? "#22c55e",
    customerName: booking.customer?.full_name ?? "Customer",
    items: [
      {
        description: `${serviceName} — appointment on ${dateStr}`,
        type: booking.service?.category ?? "service",
        quantity: 1,
        unit_price: subtotal,
      },
    ],
    subtotal,
    vatRate,
    vatAmount,
    total,
    notes: booking.notes,
    payUrl: null,
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  await sendEmail({
    to: customerEmail,
    subject: `Receipt ${invoiceNumber} from ${garageName} — ${fmt(total)} paid`,
    text: `Receipt ${invoiceNumber} from ${garageName}. Total paid: ${fmt(total)}. Service: ${serviceName} on ${dateStr}. Thanks for your booking.`,
    html,
  });

  // Push invoice + payment to Xero (fire-and-forget).
  try {
    const xeroInvoiceId = await pushInvoiceToXero(invoice.id);
    if (xeroInvoiceId) {
      await pushPaymentToXero({
        invoiceId: invoice.id,
        amountPence,
        paymentDate: new Date().toISOString(),
        reference: stripePaymentIntentId ?? `Booking ${bookingId.slice(0, 8)}`,
      });
    }
  } catch (err) {
    console.error("[booking-invoice] xero sync failed", err);
  }
}
