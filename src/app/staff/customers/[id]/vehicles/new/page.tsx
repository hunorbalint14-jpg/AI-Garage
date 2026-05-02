import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { VehicleForm } from "./vehicle-form";

export default async function NewVehiclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();

  const { data: customer } = await ctx.supabase
    .from("customers")
    .select("id, full_name")
    .eq("id", id)
    .maybeSingle();

  if (!customer) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/staff/customers/${customer.id}`}
          className="text-sm text-muted-foreground underline"
        >
          ← Back to {customer.full_name ?? "customer"}
        </Link>
        <h1 className="text-2xl font-bold">Add vehicle</h1>
        <p className="text-sm text-muted-foreground">
          For {customer.full_name ?? "this customer"}.
        </p>
      </div>
      <VehicleForm customerId={customer.id} />
    </div>
  );
}
