import Link from "next/link";
import { Building2 } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { NewFleetForm } from "./new-fleet-form";

type FleetRow = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  created_at: string;
  customerCount: number;
  vehicleCount: number;
};

export default async function FleetPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: companies } = await admin
    .from("fleet_companies")
    .select("id, name, contact_name, contact_email, contact_phone, created_at")
    .eq("location_id", ctx.location.id)
    .order("name", { ascending: true });

  // Get customer + vehicle counts per company
  const rows: FleetRow[] = await Promise.all(
    (companies ?? []).map(async (c) => {
      const [custRes, vehRes] = await Promise.all([
        admin.from("customers").select("id", { count: "exact", head: true })
          .eq("fleet_company_id", c.id),
        admin.from("vehicles").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organization.id)
          .in("customer_id",
            (await admin.from("customers").select("id").eq("fleet_company_id", c.id)).data?.map((r) => r.id) ?? []
          ),
      ]);
      return { ...c, customerCount: custRes.count ?? 0, vehicleCount: vehRes.count ?? 0 };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fleet"
        description="Manage commercial customers and their vehicle fleets."
        action={<NewFleetForm />}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No fleet companies yet. Add one to group commercial customers and their vehicles.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/staff/fleet/${c.id}`}
              className="rounded-xl border p-5 flex flex-col gap-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">{c.name}</p>
                  {c.contact_name && <p className="text-xs text-muted-foreground truncate">{c.contact_name}</p>}
                  {c.contact_phone && <p className="text-xs text-muted-foreground">{c.contact_phone}</p>}
                </div>
              </div>
              <div className="flex gap-4 text-sm border-t pt-3">
                <div>
                  <p className="text-xl font-bold">{c.customerCount}</p>
                  <p className="text-xs text-muted-foreground">drivers</p>
                </div>
                <div>
                  <p className="text-xl font-bold">{c.vehicleCount}</p>
                  <p className="text-xs text-muted-foreground">vehicles</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
