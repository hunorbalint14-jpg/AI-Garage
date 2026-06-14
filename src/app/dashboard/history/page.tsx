import Link from "next/link";
import { Wrench, Car, ChevronRight, ClipboardList } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { PortalShell } from "../portal-shell";

type HistoryJob = {
  id: string;
  status: string;
  description: string | null;
  completed_at: string | null;
  created_at: string | null;
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null } | null;
};

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function vehicleName(v: HistoryJob["vehicle"]) {
  if (!v) return "Vehicle";
  return [v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
}

export default async function ServiceHistoryPage() {
  const { location, customer } = await getPortalContext();
  const org = location.organization;

  if (!customer) {
    return (
      <PortalShell org={org}>
        <EmptyState title="No account found" body={`We couldn't find a customer record linked to your email. Please contact ${org.name}.`} />
      </PortalShell>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("jobs")
    .select("id, status, description, completed_at, created_at, vehicle:vehicles(id, registration, make, model, year)")
    .eq("customer_id", customer.id)
    .in("status", ["complete", "invoiced"])
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const jobs = (data ?? []) as unknown as HistoryJob[];

  // Group by vehicle, preserving the completed-date ordering above.
  const groups = new Map<string, { vehicle: HistoryJob["vehicle"]; jobs: HistoryJob[] }>();
  for (const job of jobs) {
    const key = job.vehicle?.id ?? "unknown";
    if (!groups.has(key)) groups.set(key, { vehicle: job.vehicle, jobs: [] });
    groups.get(key)!.jobs.push(job);
  }

  return (
    <PortalShell org={org}>
      <div>
        <h1 className="text-2xl font-bold">Service history</h1>
        <p className="mt-1 text-sm text-gray-400">Completed work on your vehicles with {org.name}.</p>
      </div>

      {jobs.length === 0 ? (
        <EmptyState
          title="No completed jobs yet"
          body="Once your vehicle has been serviced, the full record — including any inspection reports — will appear here."
        />
      ) : (
        <div className="flex flex-col gap-8">
          {[...groups.values()].map(({ vehicle, jobs: vehicleJobs }) => (
            <section key={vehicle?.id ?? "unknown"}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
                <Car className="h-4 w-4" />
                <span className="font-mono tracking-widest text-gray-300">{vehicle?.registration ?? "—"}</span>
                <span className="font-sans normal-case tracking-normal text-gray-500">{vehicleName(vehicle)}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {vehicleJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/dashboard/history/${job.id}`}
                    className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm transition-colors hover:bg-white/[0.06]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${org.primary_color}25` }}>
                        <Wrench className="h-5 w-5" style={{ color: org.primary_color }} />
                      </div>
                      <div>
                        <p className="font-semibold">{job.description || "Service"}</p>
                        <p className="text-xs text-gray-400">{fmtDate(job.completed_at ?? job.created_at)}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-gray-500" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PortalShell>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
      <ClipboardList className="mx-auto mb-3 h-8 w-8 text-gray-600" />
      <p className="font-semibold">{title}</p>
      <p className="mt-2 text-sm text-gray-400">{body}</p>
    </div>
  );
}
