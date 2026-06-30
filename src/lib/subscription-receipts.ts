import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import {
  sendEmail,
  tenantBookingUrl,
  renderBrandedEmail,
  paragraphsToHtml,
  type EmailDetailRow,
} from "@/lib/email";
import { garageLabel, garageLocationBlock } from "@/lib/garage-identity";
import { TIERS, type TierKey } from "@/lib/tenant-plans";

type Admin = ReturnType<typeof createAdminClient>;

const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

// Price details off the first subscription item (the plan line).
function subPrice(sub: Stripe.Subscription): { amountPence: number | null; interval: "month" | "year" | null } {
  const price = sub.items?.data?.[0]?.price;
  const amountPence = typeof price?.unit_amount === "number" ? price.unit_amount : null;
  const i = price?.recurring?.interval;
  const interval = i === "year" ? "year" : i === "month" ? "month" : null;
  return { amountPence, interval };
}

function periodEndIso(sub: Stripe.Subscription): string | null {
  const end = sub.items?.data?.[0]?.current_period_end ?? null;
  return end ? new Date(end * 1000).toISOString() : null;
}

function priceLine(amountPence: number | null, interval: "month" | "year" | null): string | null {
  if (amountPence == null) return null;
  const per = interval === "year" ? "year" : interval === "month" ? "month" : null;
  return per ? `${gbp(amountPence)} per ${per}` : gbp(amountPence);
}

// ── Owner receipt: AI Garage (platform) subscription ───────────────────────
// Sent to the org owner after they subscribe to a paid tenant tier. Uses the
// default AI-Garage-branded email template — it's the platform billing them.
export async function sendTenantSubscriptionReceipt(sub: Stripe.Subscription): Promise<void> {
  try {
    if (sub.status !== "active" && sub.status !== "trialing") return;

    const orgId = sub.metadata?.organization_id;
    const tierKey = sub.metadata?.tier as TierKey | undefined;
    const tier = tierKey && TIERS[tierKey] ? TIERS[tierKey] : null;
    const tierName = tier?.name ?? "subscription";

    // Owner email = the email on the platform Stripe customer (set at checkout).
    const customerId = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
    if (!customerId) return;
    const customer = await stripe.customers.retrieve(customerId);
    const email = "deleted" in customer && customer.deleted ? null : customer.email;
    if (!email) {
      console.error("[receipts] tenant: no owner email", { sub: sub.id });
      return;
    }

    const { amountPence, interval } = subPrice(sub);
    const renew = longDate(periodEndIso(sub));
    const price = priceLine(amountPence, interval);

    // Deep-link to the org's billing page on its own subdomain, if we can.
    const admin = createAdminClient();
    let cta: { url: string; label: string } | undefined;
    if (orgId) {
      const { data: loc } = await admin
        .from("locations")
        .select("slug")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      const slug = (loc as { slug: string } | null)?.slug;
      if (slug) cta = { url: tenantBookingUrl(slug, "/staff/settings/billing"), label: "Manage billing" };
    }

    const lines = [
      `Thanks for subscribing to AI Garage ${tierName}.`,
      [price ? `Plan: ${tierName} — ${price}.` : `Plan: ${tierName}.`, renew ? `Next renewal: ${renew}.` : ""]
        .filter(Boolean)
        .join("\n"),
      "You can update your card, switch plan or cancel any time from Settings → Billing.",
    ];

    const sent = await sendEmail({
      to: email,
      subject: `Your AI Garage ${tierName} subscription is active`,
      text: lines.join("\n\n"),
      cta,
    });
    if (!sent.success) {
      console.error("[receipts] tenant: sendEmail failed", { sub: sub.id, to: email, error: sent.error });
    }
  } catch (err) {
    console.error("[receipts] sendTenantSubscriptionReceipt threw", err);
  }
}

// ── Customer receipt: a garage's service plan ──────────────────────────────
// Sent to the customer after they subscribe to a garage's service plan. Branded
// in the garage's colours/logo (the customer is buying from the garage, not us).
export async function sendServicePlanReceipt(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  try {
    if (sub.status !== "active" && sub.status !== "trialing") return;

    const meta = sub.metadata ?? {};
    const planId = meta.service_plan_id || null;
    const customerId = meta.customer_id || null;
    const locationId = meta.location_id || null;
    if (!customerId) return;

    const { data: customer } = await admin
      .from("customers")
      .select("full_name, email")
      .eq("id", customerId)
      .maybeSingle();
    const cust = customer as { full_name: string | null; email: string | null } | null;
    if (!cust?.email) {
      console.error("[receipts] service plan: no customer email", { sub: sub.id });
      return;
    }

    const { data: planRow } = planId
      ? await admin.from("service_plans").select("name").eq("id", planId).maybeSingle()
      : { data: null };
    const planName = (planRow as { name: string } | null)?.name ?? "membership plan";

    const { data: locRow } = locationId
      ? await admin
          .from("locations")
          .select("name, address, organization:organizations!organization_id(name, logo_url, primary_color)")
          .eq("id", locationId)
          .maybeSingle()
      : { data: null };
    const loc = locRow as unknown as {
      name: string;
      address: string | null;
      organization: { name: string; logo_url: string | null; primary_color: string | null } | null;
    } | null;
    const garageName = loc?.organization?.name ?? loc?.name ?? "your garage";
    const brandColor = loc?.organization?.primary_color ?? "#22c55e";
    const logoUrl = loc?.organization?.logo_url ?? null;
    // The branch the membership is held at (+ address) — named so the customer
    // knows which site their plan benefits apply to.
    const identity = { orgName: garageName, locationName: loc?.name ?? null, address: loc?.address ?? null };
    const where = garageLabel(identity);

    const { amountPence, interval } = subPrice(sub);
    const renew = longDate(periodEndIso(sub));
    const price = priceLine(amountPence, interval);

    const html = brandedReceiptHtml({
      garageName,
      locationLine: garageLocationBlock(identity),
      brandColor,
      logoUrl,
      customerName: cust.full_name,
      planName,
      price,
      renew,
    });

    const text = [
      `You're all set — your ${planName} membership at ${where} is active.`,
      `Location:\n${garageLocationBlock(identity)}`,
      [price ? `${price}.` : "", renew ? `Next renewal: ${renew}.` : ""].filter(Boolean).join(" "),
      "Your plan benefits apply automatically next time you book.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const sent = await sendEmail({
      to: cust.email,
      subject: `Your ${planName} membership at ${where}`,
      text,
      html,
    });
    if (!sent.success) {
      console.error("[receipts] service plan: sendEmail failed", { sub: sub.id, to: cust.email, error: sent.error });
    }
  } catch (err) {
    console.error("[receipts] sendServicePlanReceipt threw", err);
  }
}

// Garage-branded membership receipt, rendered into the shared email shell.
function brandedReceiptHtml({
  garageName,
  locationLine,
  brandColor,
  logoUrl,
  customerName,
  planName,
  price,
  renew,
}: {
  garageName: string;
  /** Branch label + address (plain text, newline-separated) for the body. */
  locationLine: string | null;
  brandColor: string;
  logoUrl: string | null;
  customerName: string | null;
  planName: string;
  price: string | null;
  renew: string | null;
}): string {
  const hello = customerName ? `Hi ${customerName.split(" ")[0]},` : "Hi,";
  const details: EmailDetailRow[] = [];
  if (locationLine) details.push({ label: "Location", value: locationLine });
  details.push({ label: "Plan", value: planName });
  if (price) details.push({ label: "Amount", value: price });
  if (renew) details.push({ label: "Next renewal", value: renew });

  return renderBrandedEmail({
    brandName: garageName,
    accentColor: brandColor,
    logoUrl,
    badge: "Membership active",
    heading: `Welcome to ${planName}`,
    bodyHtml: paragraphsToHtml(
      `${hello}\n\nThanks for joining — your membership is now active. Your plan benefits apply automatically next time you book.`,
    ),
    details,
  });
}
