import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { Button } from "@/components/ui/button";

type Customer = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

type Vehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB");
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();

  const { data: customer } = (await ctx.supabase
    .from("customers")
    .select("id, full_name, email, phone, created_at")
    .eq("id", id)
    .maybeSingle()) as { data: Customer | null };

  if (!customer) notFound();

  const { data: vehicles } = (await ctx.supabase
    .from("vehicles")
    .select("id, registration, make, model, year, mot_expiry, service_due")
    .eq("customer_id", id)
    .order("created_at", { ascending: false })) as { data: Vehicle[] | null };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/staff/customers"
          className="text-sm text-muted-foreground underline"
        >
          ← Back to customers
        </Link>
        <h1 className="text-2xl font-bold">{customer.full_name ?? "Unnamed customer"}</h1>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Contact
        </h2>
        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{customer.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Phone</dt>
          <dd>{customer.phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Customer since</dt>
          <dd>{formatDate(customer.created_at)}</dd>
        </dl>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Vehicles</h2>
          <Button
            nativeButton={false}
            render={
              <Link href={`/staff/customers/${customer.id}/vehicles/new`}>
                Add vehicle
              </Link>
            }
          />
        </div>

        {!vehicles || vehicles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No vehicles on file for this customer yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Registration</th>
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-4 py-2 font-medium">Year</th>
                  <th className="px-4 py-2 font-medium">MOT expiry</th>
                  <th className="px-4 py-2 font-medium">Service due</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id} className="border-t">
                    <td className="px-4 py-2 font-mono">{v.registration}</td>
                    <td className="px-4 py-2">
                      {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-2">{v.year ?? "—"}</td>
                    <td className="px-4 py-2">{formatDate(v.mot_expiry)}</td>
                    <td className="px-4 py-2">{formatDate(v.service_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
