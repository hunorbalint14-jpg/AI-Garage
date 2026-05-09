import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { BayManager } from "./bay-manager";

export default async function BaysPage() {
  const ctx = await requireStaffContext();

  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return (
      <p className="text-sm text-muted-foreground">
        Only owners and admins can manage bays.
      </p>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("bays")
    .select("id, name, description, sort_order")
    .eq("location_id", ctx.location.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <PageHeader
        title="Bays"
        description="Configure workshop bays. Assign bookings to a bay to see them as separate rows in the day schedule."
      />
      <BayManager bays={data ?? []} />
    </div>
  );
}
