"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type ActionResult = { error: string } | { success: true };

export type NewPOItem = { productId: string | null; description: string; quantity: number; unitCost: number };

export async function createPurchaseOrder(input: {
  supplierId: string | null;
  reference: string | null;
  notes: string | null;
  items: NewPOItem[];
}): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };

  const items = (input.items ?? []).filter((it) => it.description?.trim() && it.quantity > 0);
  if (items.length === 0) return { error: "Add at least one line item." };

  const admin = createAdminClient();

  // Validate supplier belongs to the location (if one was chosen).
  let supplierId: string | null = null;
  if (input.supplierId) {
    const { data: s } = await admin.from("suppliers").select("id").eq("id", input.supplierId).eq("location_id", ctx.location.id).maybeSingle();
    supplierId = s ? input.supplierId : null;
  }

  const { data: po, error } = await admin
    .from("purchase_orders")
    .insert({
      location_id: ctx.location.id,
      supplier_id: supplierId,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: ctx.user.id,
      status: "draft",
    })
    .select("id")
    .single();
  if (error || !po) return { error: error?.message ?? "Could not create the purchase order." };

  // Only link product ids that belong to this location.
  const { data: prods } = await admin.from("products").select("id").eq("location_id", ctx.location.id);
  const validProductIds = new Set((prods ?? []).map((p) => (p as { id: string }).id));

  const rows = items.map((it, i) => ({
    purchase_order_id: po.id,
    product_id: it.productId && validProductIds.has(it.productId) ? it.productId : null,
    description: it.description.trim(),
    quantity: it.quantity,
    unit_cost: it.unitCost >= 0 ? it.unitCost : 0,
    sort_order: i,
  }));
  const { error: itemsErr } = await admin.from("purchase_order_items").insert(rows);
  if (itemsErr) return { error: itemsErr.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "purchase_order.create",
    entityType: "purchase_order",
    entityId: po.id,
    metadata: { supplier_id: supplierId, item_count: rows.length },
  });

  revalidatePath("/staff/purchase-orders");
  return { success: true };
}

export async function markPurchaseOrderOrdered(poId: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: po } = await admin.from("purchase_orders").select("id, location_id, status").eq("id", poId).maybeSingle();
  if (!po || po.location_id !== ctx.location.id) return { error: "Purchase order not found." };
  if (po.status !== "draft") return { error: "Only a draft can be marked as ordered." };

  const { error } = await admin
    .from("purchase_orders")
    .update({ status: "ordered", ordered_at: new Date().toISOString() })
    .eq("id", poId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "purchase_order.update",
    entityType: "purchase_order",
    entityId: poId,
    metadata: { status: "ordered" },
  });

  revalidatePath("/staff/purchase-orders");
  return { success: true };
}

// Receive a PO: add each product-linked line's quantity back into stock, then
// mark the PO received. Idempotent via the status guard (a received PO can't be
// received again).
export async function receivePurchaseOrder(poId: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: po } = await admin.from("purchase_orders").select("id, location_id, status").eq("id", poId).maybeSingle();
  if (!po || po.location_id !== ctx.location.id) return { error: "Purchase order not found." };
  if (po.status === "received") return { error: "This purchase order is already received." };
  if (po.status === "cancelled") return { error: "This purchase order was cancelled." };

  const { data: items } = await admin
    .from("purchase_order_items")
    .select("product_id, quantity")
    .eq("purchase_order_id", poId)
    .not("product_id", "is", null);

  // Increment stock per product. (Mirrors the inventory applyStockDelta path;
  // kept inline here so this PR doesn't depend on that branch.)
  const byProduct = new Map<string, number>();
  for (const it of (items ?? []) as { product_id: string; quantity: number }[]) {
    byProduct.set(it.product_id, (byProduct.get(it.product_id) ?? 0) + Number(it.quantity || 0));
  }
  for (const [productId, qty] of byProduct) {
    const delta = Math.round(qty);
    if (delta <= 0) continue;
    const { data: prod } = await admin
      .from("products")
      .select("stock_qty")
      .eq("id", productId)
      .eq("location_id", ctx.location.id)
      .maybeSingle();
    if (!prod) continue;
    const previous = (prod.stock_qty as number) ?? 0;
    const newQty = Math.max(0, previous + delta);
    await admin.from("products").update({ stock_qty: newQty }).eq("id", productId).eq("location_id", ctx.location.id);
    await logAudit({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
      action: "product.stock_adjust",
      entityType: "product",
      entityId: productId,
      metadata: { delta, previous_qty: previous, new_qty: newQty, reason: "po_receipt", purchase_order_id: poId },
    });
  }

  const { error } = await admin
    .from("purchase_orders")
    .update({ status: "received", received_at: new Date().toISOString() })
    .eq("id", poId);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "purchase_order.receive",
    entityType: "purchase_order",
    entityId: poId,
    metadata: { products: byProduct.size },
  });

  revalidatePath("/staff/purchase-orders");
  revalidatePath("/staff/products");
  return { success: true };
}

export async function deletePurchaseOrder(poId: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: po } = await admin.from("purchase_orders").select("id, location_id, status").eq("id", poId).maybeSingle();
  if (!po || po.location_id !== ctx.location.id) return { error: "Purchase order not found." };
  if (po.status === "received") return { error: "Can't delete a received purchase order." };

  const { error } = await admin.from("purchase_orders").delete().eq("id", poId).eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "purchase_order.delete",
    entityType: "purchase_order",
    entityId: poId,
  });

  revalidatePath("/staff/purchase-orders");
  return { success: true };
}
