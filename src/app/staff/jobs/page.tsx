import Link from "next/link";
import { Zap } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { PageHeader } from "@/components/staff/page-header";
import { JobFilters } from "./job-filters";

export const dynamic = "force-dynamic";

// Workshop jobs board: every job grouped by lifecycle stage. Until now jobs
// had no index at all — a job was only reachable through its booking, so
// "what's on the go right now?" had no answer in the UI.

type JobRow = {
  id: string;
  status: string;
  description: string | null;
  created_at: string;
  completed_at: string | null;
  assigned_to: string | null;
  high_voltage: boolean | null;
  customer: { full_name: string | null } | null;
  vehicle: { registration: string; make: string | null; model: string | null } | null;
};

const JOB_SELECT =
  "id, status, description, created_at, completed_at, assigned_to, high_voltage, customer:customers(full_name), vehicle:vehicles(registration, make, model)";

const COLUMN_LIMITS = { open: 100, complete: 50, invoiced: 20 } as const;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; assignee?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q, assignee: assigneeParam } = await searchParams;
  const query = q?.trim() ?? "";

  // Search: match the job description directly, or resolve customer/vehicle
  // ids first for name/reg matches (jobs carry customer_id / vehicle_id).
  let orClause: string | null = null;
  if (query) {
    const like = `%${query}%`;
    const [custRes, vehRes] = await Promise.all([
      admin
        .from("customers")
        .select("id")
        .eq("organization_id", ctx.organization.id)
        .ilike("full_name", like)
        .limit(50),
      admin
        .from("vehicles")
        .select("id")
        .eq("organization_id", ctx.organization.id)
        .ilike("registration", like)
        .limit(50),
    ]);
    const clauses = [`description.ilike.${like}`];
    const custIds = (custRes.data ?? []).map((c) => c.id);
    const vehIds = (vehRes.data ?? []).map((v) => v.id);
    if (custIds.length) clauses.push(`customer_id.in.(${custIds.join(",")})`);
    if (vehIds.length) clauses.push(`vehicle_id.in.(${vehIds.join(",")})`);
    orClause = clauses.join(",");
  }

  const staff = await listLocationStaff(ctx.location.id, ctx.organization.id);
  const assignee =
    assigneeParam && staff.some((s) => s.id === assigneeParam) ? assigneeParam : "";

  function columnQuery(status: "open" | "complete" | "invoiced") {
    let qb = admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("location_id", ctx.location.id)
      .eq("status", status);
    if (assignee) qb = qb.eq("assigned_to", assignee);
    if (orClause) qb = qb.or(orClause);
    const ordered =
      status === "open"
        ? qb.order("created_at", { ascending: false })
        : qb.order("completed_at", { ascending: false, nullsFirst: false });
    return ordered.limit(COLUMN_LIMITS[status]) as unknown as Promise<{ data: JobRow[] | null }>;
  }

  const [openRes, completeRes, invoicedRes] = await Promise.all([
    columnQuery("open"),
    columnQuery("complete"),
    columnQuery("invoiced"),
  ]);

  const nameMap = new Map(staff.map((s) => [s.id, s.name]));

  const filtered = Boolean(query || assignee);
  const columns = [
    {
      key: "open" as const,
      title: "In progress",
      hint: "Open jobs on the floor",
      accent: "border-t-amber-400",
      jobs: openRes.data ?? [],
      empty: filtered ? "No matching open jobs." : "Nothing on the go.",
    },
    {
      key: "complete" as const,
      title: "Done — not invoiced",
      hint: "Work finished, money not yet billed",
      accent: "border-t-blue-400",
      jobs: completeRes.data ?? [],
      empty: filtered ? "No matching completed jobs." : "Nothing awaiting an invoice.",
    },
    {
      key: "invoiced" as const,
      title: "Invoiced",
      hint: "Recently billed",
      accent: "border-t-green-400",
      jobs: invoicedRes.data ?? [],
      empty: filtered ? "No matching invoiced jobs." : "No invoiced jobs yet.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Every job at this location, grouped by stage. Jobs are created from a booking."
      />

      <JobFilters initialQ={query} staff={staff} assignee={assignee} />

      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map((col) => (
          <section key={col.key} className={`rounded-lg border border-t-2 ${col.accent}`}>
            <header className="border-b bg-muted/30 px-4 py-2.5">
              <h2 className="text-sm font-semibold">
                {col.title}
                <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  {col.jobs.length}
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">{col.hint}</p>
            </header>
            {col.jobs.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{col.empty}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2 p-2.5">
                  {col.jobs.map((job) => (
                    <li key={job.id}>
                      <JobCard job={job} technician={job.assigned_to ? (nameMap.get(job.assigned_to) ?? null) : null} />
                    </li>
                  ))}
                </ul>
                {col.jobs.length === COLUMN_LIMITS[col.key] && (
                  <p className="border-t px-4 py-2 text-center text-xs text-muted-foreground">
                    Showing the latest {COLUMN_LIMITS[col.key]} — use search to find older jobs.
                  </p>
                )}
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, technician }: { job: JobRow; technician: string | null }) {
  const vehicleDesc = [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ");
  const dateLabel = job.completed_at
    ? `Completed ${new Date(job.completed_at).toLocaleDateString("en-GB")}`
    : `Started ${new Date(job.created_at).toLocaleDateString("en-GB")}`;

  return (
    <Link
      href={`/staff/jobs/${job.id}`}
      className="block rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">
          {job.high_voltage && (
            <Zap
              className="mr-1 inline h-3.5 w-3.5 -translate-y-0.5 fill-amber-400 text-amber-500"
              aria-label="High-voltage vehicle"
            />
          )}
          {job.description || "Untitled job"}
        </span>
        {job.vehicle?.registration && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">
            {job.vehicle.registration}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {job.customer?.full_name ?? "—"}
        {vehicleDesc ? ` · ${vehicleDesc}` : ""}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{dateLabel}</span>
        {technician && <span className="rounded bg-muted px-1.5 py-0.5">{technician}</span>}
      </div>
    </Link>
  );
}
