import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { SupplierManager, type Supplier } from "./supplier-manager";


export default async function SuppliersPage() {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to suppliers.</p>;
  }
  const canEdit = hasPermission(ctx, "products");

  const admin = createAdminClient();
  const { data } = await admin
    .from("suppliers")
    .select("id, name, contact_email, contact_phone, notes")
    .eq("location_id", ctx.location.id)
    .order("name", { ascending: true });

  const suppliers = (data ?? []) as Supplier[];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <PageHeader
        title="Suppliers"
        description="The vendors you buy parts from. Used when raising purchase orders."
      />
      <SupplierManager suppliers={suppliers} canEdit={canEdit} />
    </div>
  );
}
