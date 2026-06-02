import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

type Admin = ReturnType<typeof createAdminClient>;

// Single point that mutates a product's stock balance and records it. Clamps at
// zero, scopes to the location, and writes a product.stock_adjust audit row with
// the reason (manual | job_consumption | job_reopen | po_receipt). Reused by the
// manual adjust action and job-completion consumption (and later PO receipt), so
// every stock change is consistent + audited. Never throws — returns ok/false.
export async function applyStockDelta(
  admin: Admin,
  args: {
    productId: string;
    locationId: string;
    delta: number;
    reason: string;
    organizationId: string | null;
    actorUserId: string | null;
    actorEmail: string | null;
    jobId?: string | null;
  },
): Promise<{ ok: boolean; newQty?: number }> {
  if (!args.delta) return { ok: true };
  try {
    const { data } = await admin
      .from("products")
      .select("stock_qty")
      .eq("id", args.productId)
      .eq("location_id", args.locationId)
      .maybeSingle();
    if (!data) return { ok: false };

    const previous = (data.stock_qty as number) ?? 0;
    const newQty = Math.max(0, previous + args.delta);

    const { error } = await admin
      .from("products")
      .update({ stock_qty: newQty })
      .eq("id", args.productId)
      .eq("location_id", args.locationId);
    if (error) return { ok: false };

    await logAudit({
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      actorEmail: args.actorEmail,
      action: "product.stock_adjust",
      entityType: "product",
      entityId: args.productId,
      metadata: { delta: args.delta, previous_qty: previous, new_qty: newQty, reason: args.reason, job_id: args.jobId ?? null },
    });

    return { ok: true, newQty };
  } catch (err) {
    console.error("[stock] applyStockDelta failed", { productId: args.productId, err });
    return { ok: false };
  }
}
