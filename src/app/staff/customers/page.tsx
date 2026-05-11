import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/staff/page-header";
import { CustomerSearch } from "./customer-search";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  let customers: CustomerRow[] | null = null;
  let error: { message: string } | null = null;

  if (query) {
    // Parallel: match by name/phone + match by vehicle reg
    const [custRes, vehRes] = await Promise.all([
      admin
        .from("customers")
        .select("id, full_name, email, phone, created_at")
        .eq("location_id", ctx.location.id)
        .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order("full_name", { ascending: true }),
      admin
        .from("vehicles")
        .select("customer_id")
        .eq("location_id", ctx.location.id)
        .ilike("registration", `%${query}%`),
    ]);

    if (custRes.error) {
      error = custRes.error;
    } else {
      const byNamePhone = custRes.data as CustomerRow[];
      const regCustomerIds = (vehRes.data ?? []).map((v: { customer_id: string }) => v.customer_id);

      // Fetch customers matched by reg (if any not already in byNamePhone)
      const existingIds = new Set(byNamePhone.map((c) => c.id));
      const missingIds = regCustomerIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        const { data: regCustomers } = await admin
          .from("customers")
          .select("id, full_name, email, phone, created_at")
          .eq("location_id", ctx.location.id)
          .in("id", missingIds)
          .order("full_name", { ascending: true });
        customers = [...byNamePhone, ...((regCustomers as CustomerRow[]) ?? [])];
      } else {
        customers = byNamePhone;
      }
    }
  } else {
    const res = await admin
      .from("customers")
      .select("id, full_name, email, phone, created_at")
      .eq("location_id", ctx.location.id)
      .order("created_at", { ascending: false });
    customers = res.data as CustomerRow[] | null;
    if (res.error) error = res.error;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="All customers registered at this location."
        action={
          <div className="flex gap-2">
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/staff/customers/import">Import CSV</Link>}
            />
            <Button
              nativeButton={false}
              render={
                <Link href="/staff/customers/new">
                  <UserPlus className="mr-1.5 inline h-4 w-4" />
                  Add customer
                </Link>
              }
            />
          </div>
        }
      />

      <CustomerSearch initialQ={query} />

      {error && (
        <p className="text-sm text-red-600">Failed to load: {error.message}</p>
      )}

      {!error && (!customers || customers.length === 0) ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {query ? `No customers found for "${query}".` : "No customers yet. Add your first one to get started."}
          </p>
          {!query && (
            <Button
              nativeButton={false}
              render={<Link href="/staff/customers/new">Add customer</Link>}
            />
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          {query && (
            <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              {customers?.length ?? 0} result{customers?.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
            </div>
          )}
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Added</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {customers?.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-4 py-2">{c.full_name ?? "—"}</td>
                  <td className="px-4 py-2">{c.email ?? "—"}</td>
                  <td className="px-4 py-2">{c.phone ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(c.created_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-3">
                      <Link href={`/staff/customers/${c.id}`} className="text-sm underline">
                        View
                      </Link>
                      <Link href={`/staff/customers/${c.id}/edit`} className="text-sm underline text-muted-foreground">
                        Edit
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
