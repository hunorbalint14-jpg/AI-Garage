"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

// Account-customer settings (#504 PR 2): the flag, payment terms, credit
// limit and consolidated-billing toggle. Finance-gated — this is billing
// configuration, not contact detail.

export type SaveAccountResult = { error: string } | { success: true };

export async function saveAccountSettings(
  customerId: string,
  args: {
    accountCustomer: boolean;
    paymentTermsDays: number;
    creditLimit: number | null;
    consolidatedBilling: boolean;
  },
): Promise<SaveAccountResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "invoices")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: cust } = await admin
    .from("customers")
    .select("id, organization_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust || (cust as { organization_id: string }).organization_id !== ctx.organization.id) {
    return { error: "Customer not found." };
  }

  const terms = Math.round(Number(args.paymentTermsDays));
  if (!Number.isFinite(terms) || terms < 0 || terms > 120) {
    return { error: "Payment terms must be between 0 and 120 days." };
  }
  let limit: number | null = null;
  if (args.creditLimit !== null) {
    limit = Math.round(Number(args.creditLimit) * 100) / 100;
    if (!Number.isFinite(limit) || limit < 0) return { error: "Credit limit must be 0 or more (leave empty for no limit)." };
  }

  const { error } = await admin
    .from("customers")
    .update({
      account_customer: args.accountCustomer,
      payment_terms_days: terms,
      credit_limit: args.accountCustomer ? limit : null,
      consolidated_billing: args.accountCustomer ? args.consolidatedBilling : false,
    })
    .eq("id", customerId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "account.updated",
    entityType: "customer",
    entityId: customerId,
    metadata: {
      account_customer: args.accountCustomer,
      payment_terms_days: terms,
      credit_limit: limit,
      consolidated_billing: args.accountCustomer && args.consolidatedBilling,
    },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}
