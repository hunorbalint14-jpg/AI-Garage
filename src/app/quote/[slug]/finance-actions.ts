"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQuoteAccess } from "@/lib/quote-links";
import { getActiveFinanceConfig, toBumperConfig } from "@/lib/finance";
import type { FinanceAddressInput, StartFinanceResult } from "@/lib/finance";
import { bumperApply } from "@/lib/finance/bumper";
import { tenantOrigin } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";

// "Spread the cost" — raises a Bumper PayLater application for a pending
// quote and returns the hosted redirect_url. Token-gated like every other
// quote action: possession of a valid quote link is the credential. The
// customer supplies their address here (we don't store addresses) — Bumper
// needs it for the soft credit check; we pass it through and don't persist it.

type QuoteFinanceRow = {
  id: string;
  location_id: string;
  total: number;
  customer: { full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { registration: string | null } | null;
  location: { slug: string; organization: { id: string } | null } | null;
};

async function loadQuoteForFinance(
  source: "job" | "standalone",
  id: string,
): Promise<{ quote: QuoteFinanceRow; items: { description: string; quantity: number; unit_price: number }[] } | null> {
  const admin = createAdminClient();
  if (source === "standalone") {
    const { data } = await admin
      .from("quotes")
      .select(
        "id, location_id, total, customer:customers(full_name, email, phone), vehicle:vehicles(registration), location:locations(slug, organization:organizations!organization_id(id))",
      )
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const { data: items } = await admin
      .from("quote_items")
      .select("description, quantity, unit_price")
      .eq("quote_id", id);
    return { quote: data as unknown as QuoteFinanceRow, items: items ?? [] };
  }

  const { data } = await admin
    .from("quotes")
    .select(
      "id, location_id, total, job:jobs(customer:customers(full_name, email, phone), vehicle:vehicles(registration)), location:locations(slug, organization:organizations!organization_id(id))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  type JobRow = Omit<QuoteFinanceRow, "customer" | "vehicle"> & {
    job: { customer: QuoteFinanceRow["customer"]; vehicle: QuoteFinanceRow["vehicle"] } | null;
  };
  const r = data as unknown as JobRow;
  const { data: items } = await admin
    .from("quote_items")
    .select("description, quantity, unit_price")
    .eq("quote_id", id);
  return {
    quote: {
      id: r.id,
      location_id: r.location_id,
      total: r.total,
      customer: r.job?.customer ?? null,
      vehicle: r.job?.vehicle ?? null,
      location: r.location,
    },
    items: items ?? [],
  };
}

export async function startFinanceApplication(
  slug: string,
  token: string,
  address: FinanceAddressInput,
): Promise<StartFinanceResult> {
  const verify = await verifyQuoteAccess(slug, token, ["pending"]);
  if (!verify.ok) return { error: "This quote link is no longer valid." };

  const loaded = await loadQuoteForFinance(verify.quote.source, verify.quote.id);
  if (!loaded) return { error: "Quote not found." };
  const { quote, items } = loaded;

  const org = quote.location?.organization;
  const tenantSlug = quote.location?.slug;
  if (!org || !tenantSlug) return { error: "Garage configuration missing." };

  const config = await getActiveFinanceConfig(org.id);
  if (!config) return { error: "Finance is not available for this garage." };
  if (Number(quote.total) < config.minAmount) {
    return { error: "This quote is below the minimum amount for finance." };
  }

  const customer = quote.customer;
  if (!customer?.email || !customer?.phone) {
    return { error: "Finance needs an email address and mobile number on file — please contact the garage." };
  }
  const town = address.town.trim();
  const postcode = address.postcode.trim();
  const buildingNumber = address.buildingNumber.trim();
  if (!town || !postcode || !buildingNumber) {
    return { error: "Please fill in your house number, town, and postcode." };
  }

  const nameParts = (customer.full_name ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || firstName;

  const admin = createAdminClient();
  const returnBase = `${tenantOrigin(tenantSlug)}/api/finance/bumper/return?qs=${encodeURIComponent(slug)}&qt=${encodeURIComponent(token)}`;

  let result;
  try {
    result = await bumperApply(
      {
        productType: "paylater",
        amount: Number(quote.total).toFixed(2),
        orderReference: quote.id,
        vehicleReg: quote.vehicle?.registration ?? undefined,
        customer: {
          firstName,
          lastName,
          email: customer.email,
          mobile: customer.phone,
          buildingNumber,
          street: address.street.trim() || undefined,
          town,
          postcode,
        },
        lines: items.map((it) => ({
          item: it.description.slice(0, 100),
          quantity: String(it.quantity),
          price: Number(it.unit_price).toFixed(2),
        })),
        successUrl: returnBase,
        failureUrl: returnBase,
      },
      toBumperConfig(config),
    );
  } catch (err) {
    console.error("[finance] bumper apply failed", err);
    return { error: "Could not start the finance application — please try again or contact the garage." };
  }

  const { error: insertError } = await admin.from("finance_applications").insert({
    organization_id: org.id,
    location_id: quote.location_id,
    provider: "bumper",
    subject_type: verify.quote.source,
    subject_id: quote.id,
    subject_ref: slug,
    token: result.token,
    order_reference: quote.id,
    amount: quote.total,
    product_type: "paylater",
    status: "pending",
    redirect_url: result.redirect_url,
  });
  if (insertError) {
    console.error("[finance] application insert failed", insertError.message);
    return { error: "Could not start the finance application — please try again." };
  }

  await logAudit({
    organizationId: org.id,
    action: "finance.application_start",
    entityType: "finance_application",
    entityId: result.token,
    metadata: { subject_type: verify.quote.source, subject_id: quote.id, amount: quote.total, provider: "bumper" },
  });

  return { redirectUrl: result.redirect_url };
}
