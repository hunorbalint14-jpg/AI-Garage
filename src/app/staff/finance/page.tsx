import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { FinanceScopeToggle } from "@/components/staff/finance-scope-toggle";


// Bumper "Spread the cost" applications raised at this location — quotes and
// invoices alike. Read-only oversight: who started finance, what completed
// (and so settled the invoice), what stalled. Scoped to ctx.location, so a
// staff member only ever sees their own location's applications.

type AppRow = {
  id: string;
  provider: string;
  subject_type: string;
  subject_id: string;
  subject_ref: string | null;
  amount: number;
  status: string;
  created_at: string;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
};

function fmt(n: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

// Where a row points and how to label it. Invoices get enriched with their
// number; job_quotes have no id-addressable detail route (the list is the
// best we can do), standalone_quotes do.
function subjectTarget(a: AppRow): string | null {
  if (a.subject_type === "invoice") return `/staff/invoices/${a.subject_id}`;
  if (a.subject_type === "standalone") return `/staff/quotes/${a.subject_id}`;
  if (a.subject_type === "job") return `/staff/quotes`;
  return null;
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  // Org finance roles (owner/admin/accountant) default to all-locations;
  // ?scope=<locationId> drops to a specific branch. Location-only staff stay
  // scoped to their branch.
  const { scope } = await searchParams;
  const accessibleIds = new Set(ctx.accessibleLocations.map((l) => l.id));
  const selectedBranch = !!ctx.orgRole && scope && scope !== "all" && accessibleIds.has(scope) ? scope : null;
  const orgWide = !!ctx.orgRole && !selectedBranch;
  const branchId = selectedBranch ?? ctx.location.id;
  const branchName = ctx.accessibleLocations.find((l) => l.id === branchId)?.name ?? ctx.location.name;

  const { data } = await (orgWide
    ? admin
        .from("finance_applications")
        .select("id, provider, subject_type, subject_id, subject_ref, amount, status, created_at")
        .eq("organization_id", ctx.organization.id)
    : admin
        .from("finance_applications")
        .select("id, provider, subject_type, subject_id, subject_ref, amount, status, created_at")
        .eq("location_id", branchId)
  )
    .order("created_at", { ascending: false })
    .limit(200);
  const apps = (data ?? []) as AppRow[];

  // Enrich invoice subjects with their number + customer in one batched read.
  const invoiceIds = apps.filter((a) => a.subject_type === "invoice").map((a) => a.subject_id);
  const invoiceMap = new Map<string, { invoice_number: string; customer: string | null }>();
  if (invoiceIds.length > 0) {
    const { data: invs } = await admin
      .from("invoices")
      .select("id, invoice_number, customer:customers(full_name)")
      .in("id", invoiceIds);
    type InvEnrich = { id: string; invoice_number: string; customer: { full_name: string | null } | null };
    for (const inv of (invs ?? []) as unknown as InvEnrich[]) {
      invoiceMap.set(inv.id, { invoice_number: inv.invoice_number, customer: inv.customer?.full_name ?? null });
    }
  }

  const completedTotal = apps
    .filter((a) => a.status === "completed")
    .reduce((s, a) => s + Number(a.amount), 0);
  const openCount = apps.filter((a) => a.status === "pending" || a.status === "in_progress").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Finance"
        description={
          orgWide
            ? "Customer finance applications (Bumper) across all branches."
            : `Customer finance applications (Bumper) raised at ${branchName}.`
        }
      />
      {ctx.orgRole && ctx.accessibleLocations.length > 1 && (
        <FinanceScopeToggle locations={ctx.accessibleLocations} />
      )}

      {apps.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Financed (completed)</p>
            <p className="text-2xl font-bold text-green-700">{fmt(completedTotal)}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">In progress</p>
            <p className="text-2xl font-bold text-blue-700">{openCount}</p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Applications</p>
            <p className="text-2xl font-bold">{apps.length}</p>
          </div>
        </div>
      )}

      {apps.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          No finance applications yet. Customers start these from the &ldquo;Spread the cost&rdquo;
          option on their quote or invoice — enable it in Settings → Customer finance.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">For</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Provider</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const enrich = a.subject_type === "invoice" ? invoiceMap.get(a.subject_id) : undefined;
                const label =
                  a.subject_type === "invoice"
                    ? `Invoice ${enrich?.invoice_number ?? ""}`.trim()
                    : "Quote";
                const target = subjectTarget(a);
                return (
                  <tr key={a.id} className="border-t">
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-2">
                      {target ? (
                        <Link href={target} className="underline">
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                    </td>
                    <td className="px-4 py-2">{enrich?.customer ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{fmt(Number(a.amount))}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[a.status] ?? ""}`}>
                        {a.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2 capitalize text-muted-foreground">{a.provider}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
