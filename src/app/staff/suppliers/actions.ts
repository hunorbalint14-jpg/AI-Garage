"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { error: string } | { success: true };

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };

  const name = (formData.get("name") as string | null)?.trim();
  const contactEmail = (formData.get("contactEmail") as string | null)?.trim() || null;
  const contactPhone = (formData.get("contactPhone") as string | null)?.trim() || null;
  const notes = (formData.get("notes") as string | null)?.trim() || null;
  if (!name) return { error: "Name is required." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("suppliers")
    .insert({ location_id: ctx.location.id, name, contact_email: contactEmail, contact_phone: contactPhone, notes })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "supplier.create",
    entityType: "supplier",
    entityId: data.id,
    metadata: { name },
  });

  revalidatePath("/staff/suppliers");
  return { success: true };
}

export async function updateSupplier(
  supplierId: string,
  fields: { name?: string; contact_email?: string | null; contact_phone?: string | null; notes?: string | null },
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  if (fields.name !== undefined && !fields.name.trim()) return { error: "Name cannot be empty." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("suppliers")
    .update(fields)
    .eq("id", supplierId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "supplier.update",
    entityType: "supplier",
    entityId: supplierId,
    metadata: { fields: fields as Record<string, unknown> },
  });

  revalidatePath("/staff/suppliers");
  return { success: true };
}

export async function deleteSupplier(supplierId: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };

  const admin = createAdminClient();
  const { error } = await admin.from("suppliers").delete().eq("id", supplierId).eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "supplier.delete",
    entityType: "supplier",
    entityId: supplierId,
  });

  revalidatePath("/staff/suppliers");
  return { success: true };
}
