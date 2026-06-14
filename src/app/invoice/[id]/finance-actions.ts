"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext, requireOwnedInvoice } from "@/lib/portal-auth";
import { getActiveFinanceConfig, toBumperConfig } from "@/lib/finance";
import type { FinanceAddressInput, StartFinanceResult } from "@/lib/finance";
import { bumperApply } from "@/lib/finance/bumper";
import { tenantOrigin } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";

// "Spread the cost" for an issued invoice. Unlike the quote flow (token-gated
// public link), the portal invoice page is authenticated, so the credential
// is the logged-in customer's ownership of the invoice — enforced here via
// requireOwnedInvoice, exactly like the page that renders the card. Raises a
// Bumper PayLater application and returns the hosted redirect_url; the address
// the customer types is passed straight to Bumper and never persisted.

export async function startInvoiceFinance(
  invoiceId: string,
  address: FinanceAddressInput,
): Promise<StartFinanceResult> {
  const { location, customer } = await getPortalContext();
  if (!customer) return { error: "Please sign in to use finance." };

  const invoice = await requireOwnedInvoice(customer.id, invoiceId);
  if (invoice.status === "paid") return { error: "This invoice has already been paid." };
  if (invoice.status === "draft") return { error: "This invoice isn't ready for payment yet." };

  const org = location.organization;
  const config = await getActiveFinanceConfig(org.id);
  if (!config) return { error: "Finance is not available for this garage." };
  if (Number(invoice.total) < config.minAmount) {
    return { error: "This invoice is below the minimum amount for finance." };
  }

  const town = address.town.trim();
  const postcode = address.postcode.trim();
  const buildingNumber = address.buildingNumber.trim();
  if (!town || !postcode || !buildingNumber) {
    return { error: "Please fill in your house number, town, and postcode." };
  }

  const admin = createAdminClient();

  // The portal context carries email but not phone; Bumper needs both.
  const { data: contact } = await admin
    .from("customers")
    .select("full_name, email, phone")
    .eq("id", customer.id)
    .maybeSingle();
  const c = contact as { full_name: string | null; email: string | null; phone: string | null } | null;
  if (!c?.email || !c?.phone) {
    return { error: "Finance needs an email address and mobile number on file — please contact the garage." };
  }

  // Line items + vehicle reg from the originating job, when there is one.
  let vehicleReg: string | undefined;
  let items: { description: string; quantity: number; unit_price: number }[] = [];
  if (invoice.job_id) {
    const [{ data: jobItems }, { data: job }] = await Promise.all([
      admin.from("job_items").select("description, quantity, unit_price").eq("job_id", invoice.job_id),
      admin.from("jobs").select("vehicle:vehicles(registration)").eq("id", invoice.job_id).maybeSingle(),
    ]);
    items = (jobItems ?? []) as typeof items;
    vehicleReg = (job as { vehicle: { registration: string | null } | null } | null)?.vehicle?.registration ?? undefined;
  }

  const nameParts = (c.full_name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || firstName;

  const lines = items.length
    ? items.map((it) => ({
        item: it.description.slice(0, 100),
        quantity: String(it.quantity),
        price: Number(it.unit_price).toFixed(2),
      }))
    : [{ item: `Invoice ${invoice.invoice_number}`, quantity: "1", price: Number(invoice.total).toFixed(2) }];

  const returnBase = `${tenantOrigin(location.slug)}/api/finance/bumper/return`;

  let result;
  try {
    result = await bumperApply(
      {
        productType: "paylater",
        amount: Number(invoice.total).toFixed(2),
        orderReference: invoice.id,
        invoiceNumber: invoice.invoice_number,
        vehicleReg,
        customer: {
          firstName,
          lastName,
          email: c.email,
          mobile: c.phone,
          buildingNumber,
          street: address.street.trim() || undefined,
          town,
          postcode,
        },
        lines,
        successUrl: returnBase,
        failureUrl: returnBase,
      },
      toBumperConfig(config),
    );
  } catch (err) {
    console.error("[finance] bumper apply failed (invoice)", err);
    return { error: "Could not start the finance application — please try again or contact the garage." };
  }

  const { error: insertError } = await admin.from("finance_applications").insert({
    organization_id: org.id,
    // The financed invoice's own branch — not the portal's primary location,
    // which can differ in a multi-location org.
    location_id: invoice.location_id,
    provider: "bumper",
    subject_type: "invoice",
    subject_id: invoice.id,
    subject_ref: invoice.invoice_number,
    token: result.token,
    order_reference: invoice.id,
    amount: invoice.total,
    product_type: "paylater",
    status: "pending",
    redirect_url: result.redirect_url,
  });
  if (insertError) {
    console.error("[finance] application insert failed (invoice)", insertError.message);
    return { error: "Could not start the finance application — please try again." };
  }

  await logAudit({
    organizationId: org.id,
    action: "finance.application_start",
    entityType: "finance_application",
    entityId: result.token,
    metadata: { subject_type: "invoice", subject_id: invoice.id, amount: invoice.total, provider: "bumper" },
  });

  return { redirectUrl: result.redirect_url };
}
