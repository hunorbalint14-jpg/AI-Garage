import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { sendEmail, tenantBookingUrl } from "@/lib/email";
import { TIERS, type TierKey } from "@/lib/tenant-plans";

type Admin = ReturnType<typeof createAdminClient>;

const gbp = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

const longDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
          .select("name, organization:organizations(name, logo_url, primary_color)")
          .eq("id", locationId)
          .maybeSingle()
      : { data: null };
    const loc = locRow as unknown as {
      name: string;
      organization: { name: string; logo_url: string | null; primary_color: string | null } | null;
    } | null;
    const garageName = loc?.organization?.name ?? loc?.name ?? "your garage";
    const brandColor = loc?.organization?.primary_color ?? "#22c55e";
    const logoUrl = loc?.organization?.logo_url ?? null;

    const { amountPence, interval } = subPrice(sub);
    const renew = longDate(periodEndIso(sub));
    const price = priceLine(amountPence, interval);

    const html = brandedReceiptHtml({
      garageName,
      brandColor,
      logoUrl,
      customerName: cust.full_name,
      planName,
      price,
      renew,
    });

    const text = [
      `You're all set — your ${planName} membership at ${garageName} is active.`,
      [price ? `${price}.` : "", renew ? `Next renewal: ${renew}.` : ""].filter(Boolean).join(" "),
      "Your plan benefits apply automatically next time you book.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const sent = await sendEmail({
      to: cust.email,
      subject: `Your ${planName} membership at ${garageName}`,
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

// Garage-branded receipt body. Inline styles only (email-safe).
function brandedReceiptHtml({
  garageName,
  brandColor,
  logoUrl,
  customerName,
  planName,
  price,
  renew,
}: {
  garageName: string;
  brandColor: string;
  logoUrl: string | null;
  customerName: string | null;
  planName: string;
  price: string | null;
  renew: string | null;
}): string {
  const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(brandColor) ? brandColor : "#22c55e";
  const hello = customerName ? `Hi ${esc(customerName.split(" ")[0])},` : "Hi,";
  const brandMark = logoUrl
    ? `<img src="${esc(logoUrl)}" width="40" height="40" alt="${esc(garageName)}" style="display:block;border-radius:8px;border:0">`
    : `<div style="width:40px;height:40px;border-radius:8px;background:#ffffff;color:${safeColor};font-weight:700;font-size:16px;line-height:40px;text-align:center">${esc(
        garageName.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2),
      )}</div>`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">${esc(label)}</td><td style="padding:8px 0;text-align:right;font-weight:600;color:#111827;font-size:14px">${esc(
      value,
    )}</td></tr>`;

  const rows = [
    row("Plan", planName),
    price ? row("Amount", price) : "",
    renew ? row("Next renewal", renew) : "",
  ].join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111827">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="background:${safeColor};padding:20px 24px;display:flex;align-items:center;gap:12px">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px">${brandMark}</td>
        <td style="color:#ffffff;font-weight:700;font-size:16px">${esc(garageName)}</td>
      </tr></table>
    </div>
    <div style="padding:28px 24px">
      <p style="margin:0 0 6px 0;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:${safeColor};font-weight:700">Membership active</p>
      <h1 style="margin:0 0 16px 0;font-size:20px;color:#111827">Welcome to ${esc(planName)}</h1>
      <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6">${hello}</p>
      <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6">Thanks for joining — your membership at ${esc(
        garageName,
      )} is now active. Your plan benefits apply automatically next time you book.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e5e7eb;margin-top:8px">${rows}</table>
    </div>
  </div>
  <p style="text-align:center;font-size:12px;color:#9ca3af;margin:16px 0 0 0">Sent by ${esc(
    garageName,
  )} via AI Garage</p>
</div>
</body></html>`;
}
