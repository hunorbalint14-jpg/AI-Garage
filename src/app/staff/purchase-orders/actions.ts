"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { applyStockDelta } from "@/lib/stock";
import { getSupplierConnector } from "@/lib/suppliers/connectors";
import { parseConfirmation } from "@/lib/suppliers/confirmation";
import { reconcileConfirmation } from "@/lib/suppliers/reconcile";
import { isConnectorError, type OrderLine } from "@/lib/suppliers/types";

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

  // Add each product-linked line back into stock via the shared helper — it
  // clamps at zero, scopes to the location, and writes the product.stock_adjust
  // audit row (reason po_receipt). The purchase_order.receive row below records
  // the PO id + product count.
  const byProduct = new Map<string, number>();
  for (const it of (items ?? []) as { product_id: string; quantity: number }[]) {
    byProduct.set(it.product_id, (byProduct.get(it.product_id) ?? 0) + Number(it.quantity || 0));
  }
  for (const [productId, qty] of byProduct) {
    const delta = Math.round(qty);
    if (delta <= 0) continue;
    await applyStockDelta(admin, {
      productId,
      locationId: ctx.location.id,
      delta,
      reason: "po_receipt",
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
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

export type SendPOResult =
  | { error: string }
  | { success: true; channel: "email"; sentTo: string; url: null }
  | { success: true; channel: "punchout"; sentTo: null; url: string };

// Send a draft PO to the supplier through its connector (#568). The manual
// connector either emails the order (done — the PO flips to 'ordered') or
// returns a punch-out basket URL, in which case NOTHING has been sent: the
// caller opens the link and the human finishes in the supplier's own basket,
// so the PO deliberately stays a draft until they mark it ordered.
export async function sendPurchaseOrderToSupplier(poId: string): Promise<SendPOResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: po } = await admin
    .from("purchase_orders")
    .select("id, location_id, status, reference, notes, supplier_id, items:purchase_order_items(description, quantity, unit_cost, product_id)")
    .eq("id", poId)
    .maybeSingle();
  if (!po || po.location_id !== ctx.location.id) return { error: "Purchase order not found." };
  if (po.status !== "draft") return { error: "Only a draft can be sent to the supplier." };
  if (!po.supplier_id) return { error: "Choose a supplier on this order first." };

  const resolved = await getSupplierConnector(po.supplier_id, ctx.location.id);
  if (!resolved) {
    return { error: "Ordering isn't set up for this supplier. Set it up on the Suppliers page." };
  }

  type RawItem = { description: string; quantity: number; unit_cost: number; product_id: string | null };
  const rawItems = (po.items ?? []) as RawItem[];
  if (rawItems.length === 0) return { error: "This order has no lines." };

  // SKUs come from the linked products so the factor can match our parts.
  const productIds = rawItems.map((i) => i.product_id).filter((id): id is string => !!id);
  const skuByProduct = new Map<string, string | null>();
  if (productIds.length > 0) {
    const { data: prods } = await admin.from("products").select("id, sku").in("id", productIds);
    for (const p of (prods ?? []) as { id: string; sku: string | null }[]) skuByProduct.set(p.id, p.sku);
  }

  const lines: OrderLine[] = rawItems.map((it) => ({
    sku: it.product_id ? (skuByProduct.get(it.product_id) ?? null) : null,
    description: it.description,
    quantity: Number(it.quantity),
    unitCost: Number(it.unit_cost),
  }));

  const { data: loc } = await admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle();
  const reference = po.reference?.trim() || `PO-${po.id.slice(0, 8).toUpperCase()}`;

  const placed = await resolved.connector.placeOrder({
    reference,
    lines,
    notes: po.notes,
    orgName: ctx.organization.name,
    locationName: ctx.location.name,
    locationAddress: (loc as { address: string | null } | null)?.address ?? null,
    replyTo: ctx.user.email ?? null,
  });
  if (isConnectorError(placed)) return { error: placed.error };

  // Stamp the PO only after the send succeeded, so we never show "sent" for an
  // order that failed. The residual failure mode is the safe one: if this
  // update fails the order is out but the PO still reads as a draft, which a
  // human can correct — the status guard above stops a second send.
  if (placed.channel === "email") {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("purchase_orders")
      .update({
        status: "ordered",
        ordered_at: now,
        sent_at: now,
        sent_channel: "email",
        supplier_order_ref: placed.supplierOrderRef,
        reference,
      })
      .eq("id", poId);
    if (error) return { error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "purchase_order.send",
    entityType: "purchase_order",
    entityId: poId,
    metadata: {
      channel: placed.channel,
      supplier_id: po.supplier_id,
      connector: resolved.integration.kind,
      lines: lines.length,
      sent_to: placed.sentTo,
    },
  });

  revalidatePath("/staff/purchase-orders");
  return placed.channel === "email"
    ? { success: true, channel: "email", sentTo: placed.sentTo ?? "", url: null }
    : { success: true, channel: "punchout", sentTo: null, url: placed.url ?? "" };
}

export type ImportConfirmationResult =
  | { error: string }
  | { success: true; matched: number; unmatched: number; costsChanged: number; supplierOrderRef: string | null };

// Close the loop on a manual order: staff paste the supplier's confirmation,
// we pull out their order reference and the confirmed costs, and write those
// costs onto the matching PO lines. The raw text is kept so a bad parse can be
// re-read by a human. Lines we can't match are reported, never guessed at.
export async function importSupplierConfirmation(
  poId: string,
  text: string,
): Promise<ImportConfirmationResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) return { error: "Permission denied." };
  if (!text?.trim()) return { error: "Paste the supplier's confirmation first." };

  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select("id, location_id, status, items:purchase_order_items(id, description, unit_cost, product_id)")
    .eq("id", poId)
    .maybeSingle();
  if (!po || po.location_id !== ctx.location.id) return { error: "Purchase order not found." };
  if (po.status === "cancelled") return { error: "This purchase order was cancelled." };

  const parsed = parseConfirmation(text);
  if (!parsed.supplierOrderRef && parsed.lines.length === 0) {
    return { error: "Couldn't read an order reference or any part lines from that text." };
  }

  type RawItem = { id: string; description: string; unit_cost: number; product_id: string | null };
  const items = (po.items ?? []) as RawItem[];
  const productIds = items.map((i) => i.product_id).filter((id): id is string => !!id);
  const skuByProduct = new Map<string, string | null>();
  if (productIds.length > 0) {
    const { data: prods } = await admin.from("products").select("id, sku").in("id", productIds);
    for (const p of (prods ?? []) as { id: string; sku: string | null }[]) skuByProduct.set(p.id, p.sku);
  }

  const { matches, unmatched } = reconcileConfirmation(
    items.map((it) => ({
      id: it.id,
      description: it.description,
      sku: it.product_id ? (skuByProduct.get(it.product_id) ?? null) : null,
    })),
    parsed.lines,
  );

  // Only write costs that actually moved — an unchanged confirmation
  // shouldn't churn rows or make the summary claim work it didn't do.
  const costByItem = new Map(items.map((it) => [it.id, Number(it.unit_cost)]));
  let costsChanged = 0;
  for (const m of matches) {
    if (Math.abs((costByItem.get(m.itemId) ?? 0) - m.unitCost) < 0.005) continue;
    const { error } = await admin
      .from("purchase_order_items")
      .update({ unit_cost: m.unitCost })
      .eq("id", m.itemId)
      .eq("purchase_order_id", poId);
    if (!error) costsChanged++;
  }

  const { error: poErr } = await admin
    .from("purchase_orders")
    .update({
      confirmation_raw: text.slice(0, 20000),
      confirmation_imported_at: new Date().toISOString(),
      ...(parsed.supplierOrderRef ? { supplier_order_ref: parsed.supplierOrderRef } : {}),
    })
    .eq("id", poId);
  if (poErr) return { error: poErr.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "purchase_order.confirmation_import",
    entityType: "purchase_order",
    entityId: poId,
    metadata: {
      supplier_order_ref: parsed.supplierOrderRef,
      matched: matches.length,
      unmatched: unmatched.length,
      costs_changed: costsChanged,
    },
  });

  revalidatePath("/staff/purchase-orders");
  return {
    success: true,
    matched: matches.length,
    unmatched: unmatched.length,
    costsChanged,
    supplierOrderRef: parsed.supplierOrderRef,
  };
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
