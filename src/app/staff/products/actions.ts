"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_PRODUCTS, PRODUCT_CATEGORIES } from "./constants";
import { logAudit } from "@/lib/audit";

type ActionResult = { error: string } | { success: true };

export async function seedDefaultProducts(locationId: string) {
  const admin = createAdminClient();
  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId);

  if ((count ?? 0) > 0) return;

  await admin.from("products").insert(
    DEFAULT_PRODUCTS.map((p) => ({
      location_id: locationId,
      name: p.name,
      category: p.category,
      unit_price: p.unit_price,
      cost_price: p.cost_price ?? null,
      stock_qty: 0,
      active: true,
    })),
  );
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) {
    return { error: "Permission denied." };
  }

  const name = (formData.get("name") as string | null)?.trim();
  const category = (formData.get("category") as string | null)?.trim();
  const sku = (formData.get("sku") as string | null)?.trim() || null;
  const supplier = (formData.get("supplier") as string | null)?.trim() || null;
  const unitPrice = parseFloat(formData.get("unitPrice") as string);
  const costPrice = parseFloat(formData.get("costPrice") as string);
  const stockQty = parseInt(formData.get("stockQty") as string, 10);

  if (!name) return { error: "Name is required." };
  if (!category || !PRODUCT_CATEGORIES.includes(category as never)) return { error: "Invalid category." };
  if (Number.isNaN(unitPrice) || unitPrice < 0) return { error: "Invalid unit price." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .insert({
      location_id: ctx.location.id,
      name,
      category,
      sku,
      supplier,
      unit_price: unitPrice,
      cost_price: Number.isNaN(costPrice) ? null : costPrice,
      stock_qty: Number.isNaN(stockQty) ? 0 : stockQty,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "product.create",
    entityType: "product",
    entityId: data.id,
    metadata: { name, category, sku, supplier, unit_price: unitPrice },
  });

  revalidatePath("/staff/products");
  return { success: true };
}

export async function updateProduct(
  productId: string,
  fields: { unit_price?: number; cost_price?: number | null; stock_qty?: number; sku?: string | null; supplier?: string | null; active?: boolean },
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) {
    return { error: "Permission denied." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update(fields)
    .eq("id", productId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "product.update",
    entityType: "product",
    entityId: productId,
    metadata: { fields: fields as Record<string, unknown> },
  });

  revalidatePath("/staff/products");
  return { success: true };
}

export async function deleteProduct(productId: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) {
    return { error: "Permission denied." };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "product.delete",
    entityType: "product",
    entityId: productId,
  });

  revalidatePath("/staff/products");
  return { success: true };
}

export async function adjustStock(productId: string, delta: number): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data } = await admin
    .from("products")
    .select("stock_qty")
    .eq("id", productId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!data) return { error: "Product not found." };

  const newQty = Math.max(0, (data.stock_qty as number) + delta);
  const { error } = await admin
    .from("products")
    .update({ stock_qty: newQty })
    .eq("id", productId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "product.stock_adjust",
    entityType: "product",
    entityId: productId,
    metadata: { delta, previous_qty: data.stock_qty, new_qty: newQty },
  });

  revalidatePath("/staff/products");
  return { success: true };
}
