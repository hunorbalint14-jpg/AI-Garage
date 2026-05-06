import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { ServiceCard, AddServiceButton, type ServiceRow } from "./service-modal";

const CATEGORY_ORDER = ["mot", "servicing", "brakes", "tyres", "exhausts", "clutch & gearbox", "electrics", "air conditioning", "diagnostics", "bodywork", "general"];

export default async function ServicesPage() {
  const ctx = await requireStaffContext();
  if (!ctx.orgRole) redirect("/staff");

  const admin = createAdminClient();

  const { data: services } = await admin
    .from("services")
    .select("id, name, category, description, price, duration_minutes, vat_included, active")
    .eq("location_id", ctx.location.id)
    .order("active", { ascending: false })
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  const rows = (services ?? []) as ServiceRow[];

  // Group by category
  const grouped = new Map<string, ServiceRow[]>();
  for (const s of rows) {
    const cat = s.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(s);
  }

  // Sort by category order
  const sorted = [...grouped.entries()].sort(([a], [b]) => {
    const ai = CATEGORY_ORDER.indexOf(a.toLowerCase());
    const bi = CATEGORY_ORDER.indexOf(b.toLowerCase());
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  function capitalize(s: string) {
    return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Services"
        description="Manage the services your garage offers, prices, and durations."
        action={<AddServiceButton />}
      />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No services added yet. Add your first service to get started.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sorted.map(([category, categoryServices]) => (
            <section key={category}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {capitalize(category)}
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {categoryServices.map((s) => (
                  <ServiceCard key={s.id} service={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
