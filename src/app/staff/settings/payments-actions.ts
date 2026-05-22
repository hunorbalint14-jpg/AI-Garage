"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, publicOrigin } from "@/lib/stripe";
import { logAudit } from "@/lib/audit";

type StartConnectResult = { error: string } | { url: string };

// Create or reuse a Stripe Connect Express account for the current org and
// return an Account Link the user can follow to complete onboarding. Owners
// and admins only — this is a money-handling action.
export async function startStripeConnect(): Promise<StartConnectResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can connect Stripe." };
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, stripe_account_id")
    .eq("id", ctx.organization.id)
    .maybeSingle();

  if (!org) return { error: "Organisation not found." };

  let accountId = org.stripe_account_id as string | null;

  if (!accountId) {
    try {
      const account = await stripe.accounts.create({
        type: "express",
        country: "GB",
        default_currency: "gbp",
        business_type: "company",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: org.name as string,
          mcc: "7549", // Towing / automotive services
          product_description:
            "Vehicle servicing, MOT and repair work invoiced through AI Garage.",
        },
        metadata: { organization_id: org.id as string },
      });
      accountId = account.id;
      await admin
        .from("organizations")
        .update({ stripe_account_id: accountId })
        .eq("id", org.id);
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? `Stripe account create failed: ${err.message}`
            : "Stripe account create failed.",
      };
    }
  }

  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${publicOrigin()}/api/stripe/connect/refresh`,
      return_url: `${publicOrigin()}/api/stripe/connect/return`,
      type: "account_onboarding",
    });
    await logAudit({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
      action: "stripe.connect_start",
      entityType: "stripe_account",
      entityId: accountId,
    });
    return { url: link.url };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Stripe onboarding link failed: ${err.message}`
          : "Stripe onboarding link failed.",
    };
  }
}

type RefreshStatusResult =
  | { error: string }
  | {
      success: true;
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
    };

// Pull the latest account status from Stripe and persist the three flags
// we care about. Called by the return URL handler and by a manual refresh
// button on the settings page.
export async function refreshStripeAccountStatus(): Promise<RefreshStatusResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Only owners and admins can refresh Stripe status." };
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, stripe_account_id")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  if (!org?.stripe_account_id) return { error: "Stripe not connected yet." };

  try {
    const account = await stripe.accounts.retrieve(org.stripe_account_id as string);
    const chargesEnabled = !!account.charges_enabled;
    const payoutsEnabled = !!account.payouts_enabled;
    const detailsSubmitted = !!account.details_submitted;

    await admin
      .from("organizations")
      .update({
        stripe_charges_enabled: chargesEnabled,
        stripe_payouts_enabled: payoutsEnabled,
        stripe_details_submitted: detailsSubmitted,
      })
      .eq("id", org.id);

    await logAudit({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
      action: "stripe.status_refresh",
      entityType: "stripe_account",
      entityId: org.stripe_account_id as string,
      metadata: {
        charges_enabled: chargesEnabled,
        payouts_enabled: payoutsEnabled,
        details_submitted: detailsSubmitted,
      },
    });

    revalidatePath("/staff/settings");
    return { success: true, chargesEnabled, payoutsEnabled, detailsSubmitted };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Stripe status fetch failed: ${err.message}`
          : "Stripe status fetch failed.",
    };
  }
}

// Owner-only redirect to the Stripe Express dashboard for the connected
// account (for the garage to view payouts, balance, etc.).
export async function openStripeDashboard(): Promise<void> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return;

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  if (!org?.stripe_account_id) return;

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "stripe.dashboard_open",
    entityType: "stripe_account",
    entityId: org.stripe_account_id as string,
  });

  const link = await stripe.accounts.createLoginLink(org.stripe_account_id as string);
  redirect(link.url);
}
