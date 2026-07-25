import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { listSupplierIntegrations } from "@/lib/suppliers/connectors";
import { SupplierManager, type Supplier } from "./supplier-manager";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "products")) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to suppliers.</p>;
  }
  const canEdit = hasPermission(ctx, "products");

  const admin = createAdminClient();
  const [{ data }, integrations] = await Promise.all([
    admin
      .from("suppliers")
      .select("id, name, contact_email, contact_phone, notes")
      .eq("location_id", ctx.location.id)
      .order("name", { ascending: true }),
    listSupplierIntegrations(ctx.location.id),
  ]);

  type SupplierRow = Omit<Supplier, "ordering">;
  const suppliers: Supplier[] = ((data ?? []) as SupplierRow[]).map((s) => {
    const i = integrations.get(s.id);
    return {
      ...s,
      // Credential *values* never leave the server — only whether they're set.
      ordering: i
        ? {
            kind: i.kind,
            enabled: i.enabled,
            punchoutUrlTemplate: i.punchoutUrlTemplate,
            orderEmail: i.orderEmail,
            accountNumber: i.accountNumber,
            hasCredentials: i.hasCredentials,
          }
        : null,
    };
  });

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
