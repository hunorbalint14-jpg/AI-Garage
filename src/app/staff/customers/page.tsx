import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { Button } from "@/components/ui/button";

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export default async function CustomersPage() {
  const ctx = await requireStaffContext();

  const { data: customers, error } = (await ctx.supabase
    .from("customers")
    .select("id, full_name, email, phone, created_at")
    .order("created_at", { ascending: false })) as {
    data: CustomerRow[] | null;
    error: { message: string } | null;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            All customers registered with your garage.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/staff/customers/new">Add customer</Link>}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600">Failed to load: {error.message}</p>
      )}

      {!error && (!customers || customers.length === 0) ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No customers yet. Add your first one to get started.
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/staff/customers/new">Add customer</Link>}
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
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
                    <Link
                      href={`/staff/customers/${c.id}`}
                      className="text-sm underline"
                    >
                      View
                    </Link>
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
