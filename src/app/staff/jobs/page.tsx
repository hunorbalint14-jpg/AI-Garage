import Link from "next/link";
import { Zap } from "lucide-react";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { PageHeader } from "@/components/staff/page-header";

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

export default async function JobsPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [openRes, completeRes, invoicedRes, staff] = await Promise.all([
    admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("location_id", ctx.location.id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100) as unknown as Promise<{ data: JobRow[] | null }>,
    admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("location_id", ctx.location.id)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(50) as unknown as Promise<{ data: JobRow[] | null }>,
    admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("location_id", ctx.location.id)
      .eq("status", "invoiced")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(20) as unknown as Promise<{ data: JobRow[] | null }>,
    listLocationStaff(ctx.location.id, ctx.organization.id),
  ]);

  const nameMap = new Map(staff.map((s) => [s.id, s.name]));

  const columns = [
    {
      key: "open",
      title: "In progress",
      hint: "Open jobs on the floor",
      accent: "border-t-amber-400",
      jobs: openRes.data ?? [],
      empty: "Nothing on the go.",
    },
    {
      key: "complete",
      title: "Done — not invoiced",
      hint: "Work finished, money not yet billed",
      accent: "border-t-blue-400",
      jobs: completeRes.data ?? [],
      empty: "Nothing awaiting an invoice.",
    },
    {
      key: "invoiced",
      title: "Invoiced",
      hint: "Recently billed",
      accent: "border-t-green-400",
      jobs: invoicedRes.data ?? [],
      empty: "No invoiced jobs yet.",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        description="Every job at this location, grouped by stage. Jobs are created from a booking."
      />

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
              <ul className="flex flex-col gap-2 p-2.5">
                {col.jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard job={job} technician={job.assigned_to ? (nameMap.get(job.assigned_to) ?? null) : null} />
                  </li>
                ))}
              </ul>
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
