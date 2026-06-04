import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { PurchaseOrderManager, type PORow, type POProduct, type POSupplier } from "./po-manager";

export const dynamic = "force-dynamic";

export default async function PurchaseOrdersPage() {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to purchase orders.</p>;
  }
  const canEdit = hasPermission(ctx, "products");

  const admin = createAdminClient();
  const [poRes, suppliersRes, productsRes] = await Promise.all([
    admin
      .from("purchase_orders")
      .select(
        "id, reference, status, ordered_at, received_at, created_at, supplier:suppliers(name), items:purchase_order_items(id, description, quantity, unit_cost, product_id)",
      )
      .eq("location_id", ctx.location.id)
      .order("created_at", { ascending: false }),
    admin.from("suppliers").select("id, name").eq("location_id", ctx.location.id).order("name", { ascending: true }),
    admin.from("products").select("id, name, cost_price, unit_price").eq("location_id", ctx.location.id).eq("active", true).order("name", { ascending: true }),
  ]);

  type RawPO = {
    id: string;
    reference: string | null;
    status: string;
    ordered_at: string | null;
    received_at: string | null;
    created_at: string;
    supplier: { name: string } | null;
    items: { id: string; description: string; quantity: number; unit_cost: number; product_id: string | null }[] | null;
  };

  const orders: PORow[] = ((poRes.data ?? []) as unknown as RawPO[]).map((po) => ({
    id: po.id,
    reference: po.reference,
    status: po.status,
    orderedAt: po.ordered_at,
    receivedAt: po.received_at,
    createdAt: po.created_at,
    supplierName: po.supplier?.name ?? null,
    items: po.items ?? [],
  }));

  const suppliers = (suppliersRes.data ?? []) as POSupplier[];
  const products = (productsRes.data ?? []) as POProduct[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Purchase orders"
        description="Raise orders to your suppliers. Receiving an order adds its parts back into stock."
      />
      <PurchaseOrderManager orders={orders} suppliers={suppliers} products={products} canEdit={canEdit} />
    </div>
  );
}
