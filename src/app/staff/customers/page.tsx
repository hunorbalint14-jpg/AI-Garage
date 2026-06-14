import Link from "next/link";
import { UserPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/staff/page-header";
import { CustomerSearch } from "./customer-search";
import { CustomerTable, type CustomerListRow } from "./customer-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const SEARCH_LIMIT = 100;

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  vehicles: { registration: string }[] | null;
  preferred_location: { name: string | null } | null;
};

const CUSTOMER_SELECT =
  "id, full_name, email, phone, created_at, vehicles(registration), preferred_location:locations(name)";

function toListRow(c: CustomerRow): CustomerListRow {
  return {
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    phone: c.phone,
    created_at: c.created_at,
    registrations: (c.vehicles ?? []).map((v) => v.registration),
    preferredLocationName: c.preferred_location?.name ?? null,
  };
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() ?? "";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  let customers: CustomerRow[] | null = null;
  let totalCount: number | null = null;
  let error: { message: string } | null = null;

  if (query) {
    // Parallel: match by name/phone + match by vehicle reg
    const [custRes, vehRes] = await Promise.all([
      admin
        .from("customers")
        .select(CUSTOMER_SELECT)
        .eq("organization_id", ctx.organization.id)
        .or(`full_name.ilike.%${query}%,phone.ilike.%${query}%`)
        .order("full_name", { ascending: true })
        .limit(SEARCH_LIMIT),
      admin
        .from("vehicles")
        .select("customer_id")
        .eq("organization_id", ctx.organization.id)
        .ilike("registration", `%${query}%`)
        .limit(SEARCH_LIMIT),
    ]);

    if (custRes.error) {
      error = custRes.error;
    } else {
      const byNamePhone = custRes.data as unknown as CustomerRow[];
      const regCustomerIds = (vehRes.data ?? []).map((v: { customer_id: string }) => v.customer_id);

      // Fetch customers matched by reg (if any not already in byNamePhone)
      const existingIds = new Set(byNamePhone.map((c) => c.id));
      const missingIds = regCustomerIds.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        const { data: regCustomers } = await admin
          .from("customers")
          .select(CUSTOMER_SELECT)
          .eq("organization_id", ctx.organization.id)
          .in("id", missingIds)
          .order("full_name", { ascending: true });
        customers = [...byNamePhone, ...((regCustomers as unknown as CustomerRow[]) ?? [])];
      } else {
        customers = byNamePhone;
      }
    }
  } else {
    // Paginated default list — the table previously rendered EVERY customer.
    const from = (page - 1) * PAGE_SIZE;
    const res = await admin
      .from("customers")
      .select(CUSTOMER_SELECT, { count: "exact" })
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    customers = res.data as unknown as CustomerRow[] | null;
    totalCount = res.count;
    if (res.error) error = res.error;
  }

  const rows = (customers ?? []).map(toListRow);
  const totalPages = totalCount !== null ? Math.max(1, Math.ceil(totalCount / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="All customers across your garages."
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

      {!error && rows.length === 0 ? (
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
      ) : !error ? (
        <div className="flex flex-col gap-3">
          {query && (
            <p className="text-xs text-muted-foreground">
              {rows.length} result{rows.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
              {rows.length >= SEARCH_LIMIT ? " (showing first matches — refine to narrow down)" : ""}
            </p>
          )}
          <CustomerTable rows={rows} showBranch={ctx.accessibleLocations.length > 1} />
          {!query && totalCount !== null && totalCount > PAGE_SIZE && (
            <Pagination page={page} totalPages={totalPages} totalCount={totalCount} />
          )}
        </div>
      ) : null}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  totalCount,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
}) {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, totalCount);
  const linkClass =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted";
  const disabledClass =
    "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground/50 pointer-events-none";

  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-muted-foreground">
        {from}–{to} of {totalCount}
      </p>
      <div className="flex gap-2">
        <Link
          href={`/staff/customers?page=${page - 1}`}
          className={page > 1 ? linkClass : disabledClass}
          aria-disabled={page <= 1}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Previous
        </Link>
        <Link
          href={`/staff/customers?page=${page + 1}`}
          className={page < totalPages ? linkClass : disabledClass}
          aria-disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
