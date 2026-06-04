import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedDefaultProducts } from "./actions";
import { ProductManager } from "./product-manager";

export const dynamic = "force-dynamic";

type ProductRow = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  supplier: string | null;
  unit_price: number;
  cost_price: number | null;
  stock_qty: number;
  reorder_at: number | null;
  active: boolean;
};

export default async function ProductsPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const canEdit = ctx.orgRole === "owner" || ctx.orgRole === "admin";

  await seedDefaultProducts(ctx.location.id);

  const { data, error } = await admin
    .from("products")
    .select("id, name, category, sku, supplier, unit_price, cost_price, stock_qty, reorder_at, active")
    .eq("location_id", ctx.location.id)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const products = (data ?? []) as ProductRow[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Parts catalogue. Edit prices and stock inline. Use Order to search UK parts suppliers.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">Failed to load: {error.message}</p>}

      <ProductManager products={products} canEdit={canEdit} />
    </div>
  );
}
