"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { error: string } | { success: true };

export async function updateConsent(
  customerId: string,
  emailConsent: boolean,
  smsConsent: boolean,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "customers")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { error } = await admin
    .from("customers")
    .update({
      marketing_email_consent: emailConsent,
      marketing_sms_consent: smsConsent,
      consent_updated_at: new Date().toISOString(),
    })
    .eq("id", customerId)
    .eq("organization_id", ctx.organization.id);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.consent_update",
    entityType: "customer",
    entityId: customerId,
    metadata: { email_consent: emailConsent, sms_consent: smsConsent },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  return { success: true };
}

export async function anonymizeCustomer(
  customerId: string,
  reason: string,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "gdpr_actions")) {
    return { error: "Only owners/admins can erase customer data." };
  }
  if (!reason.trim()) return { error: "Reason is required for audit log." };

  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, organization_id, email, anonymized_at")
    .eq("id", customerId)
    .maybeSingle();

  if (!customer || customer.organization_id !== ctx.organization.id) {
    return { error: "Customer not found." };
  }
  if (customer.anonymized_at) {
    return { error: "Customer already anonymized." };
  }

  const emailHash = customer.email
    ? createHash("sha256").update(customer.email.toLowerCase()).digest("hex").slice(0, 16)
    : null;

  const anonName = `Erased customer ${customerId.slice(0, 8)}`;

  const { error: updErr } = await admin
    .from("customers")
    .update({
      full_name: anonName,
      email: null,
      phone: null,
      marketing_email_consent: false,
      marketing_sms_consent: false,
      anonymized_at: new Date().toISOString(),
    })
    .eq("id", customerId);

  if (updErr) return { error: updErr.message };

  await admin.from("data_deletion_log").insert({
    location_id: ctx.location.id,
    customer_id: customerId,
    customer_email_hash: emailHash,
    reason,
    requested_by: ctx.user.id,
    notes: `Anonymized by ${ctx.user.email ?? ctx.user.id}`,
  });

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.anonymize",
    entityType: "customer",
    entityId: customerId,
    metadata: { reason, email_hash: emailHash },
  });

  revalidatePath(`/staff/customers/${customerId}`);
  revalidatePath("/staff/customers");
  return { success: true };
}

export async function exportCustomerData(customerId: string): Promise<
  { error: string } | { success: true; data: string }
> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "gdpr_actions")) return { error: "Permission denied." };
  const admin = createAdminClient();

  // Customers are org-global; export ALL of the customer's data across every
  // branch (scoped by customer_id, which is unique within the org).
  const [custRes, vehRes, bookingsRes, jobsRes, invoicesRes, remindersRes] = await Promise.all([
    admin.from("customers").select("*").eq("id", customerId).eq("organization_id", ctx.organization.id).maybeSingle(),
    admin.from("vehicles").select("*").eq("customer_id", customerId),
    admin.from("bookings").select("*").eq("customer_id", customerId),
    admin.from("jobs").select("*").eq("customer_id", customerId),
    admin.from("invoices").select("*").eq("customer_id", customerId),
    admin.from("reminders").select("*").eq("customer_id", customerId),
  ]);

  if (!custRes.data) return { error: "Customer not found." };

  const exportObj = {
    exported_at: new Date().toISOString(),
    exported_by: ctx.user.email ?? ctx.user.id,
    customer: custRes.data,
    vehicles: vehRes.data ?? [],
    bookings: bookingsRes.data ?? [],
    jobs: jobsRes.data ?? [],
    invoices: invoicesRes.data ?? [],
    reminders: remindersRes.data ?? [],
  };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.data_export",
    entityType: "customer",
    entityId: customerId,
    metadata: {
      vehicle_count: (vehRes.data ?? []).length,
      booking_count: (bookingsRes.data ?? []).length,
      invoice_count: (invoicesRes.data ?? []).length,
      reminder_count: (remindersRes.data ?? []).length,
    },
  });

  return { success: true, data: JSON.stringify(exportObj, null, 2) };
}

export async function deleteCustomerHard(
  customerId: string,
  reason: string,
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") {
    return { error: "Only owners can hard-delete customer records." };
  }
  if (!reason.trim()) return { error: "Reason required." };

  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, organization_id, email")
    .eq("id", customerId)
    .maybeSingle();

  if (!customer || customer.organization_id !== ctx.organization.id) {
    return { error: "Customer not found." };
  }

  // Check for invoices — hard deletion blocked if any exist (tax records)
  const { count: invoiceCount } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);

  if ((invoiceCount ?? 0) > 0) {
    return { error: "Customer has invoices. Anonymize instead — invoices must be kept for tax compliance." };
  }

  const emailHash = customer.email
    ? createHash("sha256").update(customer.email.toLowerCase()).digest("hex").slice(0, 16)
    : null;

  await admin.from("data_deletion_log").insert({
    location_id: ctx.location.id,
    customer_id: null,
    customer_email_hash: emailHash,
    reason,
    requested_by: ctx.user.id,
    notes: `Hard delete by ${ctx.user.email ?? ctx.user.id}`,
  });

  const { error } = await admin.from("customers").delete().eq("id", customerId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "customer.hard_delete",
    entityType: "customer",
    entityId: customerId,
    metadata: { reason, email_hash: emailHash },
  });

  revalidatePath("/staff/customers");
  redirect("/staff/customers");
}
