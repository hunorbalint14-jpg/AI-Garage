import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { EditCustomerForm } from "./edit-customer-form";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, full_name, email, phone")
    .eq("id", id)
    .eq("location_id", ctx.location.id)
    .maybeSingle();

  if (!customer) notFound();

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <div>
        <Link
          href={`/staff/customers/${id}`}
          className="text-sm text-muted-foreground underline"
        >
          ← Back to customer
        </Link>
        <h1 className="text-2xl font-bold">Edit customer</h1>
      </div>
      <EditCustomerForm customer={customer} />
    </div>
  );
}
