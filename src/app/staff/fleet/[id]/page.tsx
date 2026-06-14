import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { FleetDetail } from "./fleet-detail";

type Company = {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  location_id: string;
};

type Customer = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type Vehicle = {
  id: string;
  customer_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
};

export default async function FleetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: company } = await admin
    .from("fleet_companies")
    .select("id, name, contact_name, contact_email, contact_phone, notes, location_id")
    .eq("id", id)
    .maybeSingle();

  const c = company as Company | null;
  if (!c || c.location_id !== ctx.location.id) notFound();

  const { data: customers } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("fleet_company_id", id)
    .order("full_name", { ascending: true });

  const customerIds = (customers ?? []).map((cu) => cu.id);

  const { data: vehicles } = customerIds.length > 0
    ? await admin
        .from("vehicles")
        .select("id, customer_id, registration, make, model, year, mot_expiry, service_due")
        .in("customer_id", customerIds)
        .order("registration", { ascending: true })
    : { data: [] };

  // Unassigned customers across the org (for adding to fleet)
  const { data: unassigned } = await admin
    .from("customers")
    .select("id, full_name, email")
    .eq("organization_id", ctx.organization.id)
    .is("fleet_company_id", null)
    .order("full_name", { ascending: true })
    .limit(200);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/staff/fleet" className="text-sm text-muted-foreground underline">
          ← Back to fleet
        </Link>
      </div>
      <FleetDetail
        company={c}
        customers={(customers ?? []) as Customer[]}
        vehicles={(vehicles ?? []) as Vehicle[]}
        unassignedCustomers={(unassigned ?? []) as { id: string; full_name: string | null; email: string | null }[]}
      />
    </div>
  );
}
