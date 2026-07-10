import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { MicroLabel, Plate, WorkshopBadge } from "@/components/staff/workshop";
import { DemoChip } from "@/components/staff/demo-chip";
import { JobFilters } from "./job-filters";
import { InvoiceButton } from "./invoice-button";

export const dynamic = "force-dynamic";

// Workshop floor (UX review §1e): every job grouped by lifecycle stage, and
// every card carries the reg, an aging dot, a plain-English age and the £
// value — the "Done · unbilled" column is where the garage leaks money, so it
// gets an alarm surface, a £-waiting total and a one-click INVOICE action.

type JobRow = {
  id: string;
  status: string;
  description: string | null;
  created_at: string;
  completed_at: string | null;
  assigned_to: string | null;
  high_voltage: boolean | null;
  is_demo: boolean;
  customer: { full_name: string | null } | null;
  vehicle: { registration: string; make: string | null; model: string | null } | null;
};

const JOB_SELECT =
  "id, status, description, created_at, completed_at, assigned_to, high_voltage, is_demo, customer:customers(full_name), vehicle:vehicles(registration, make, model)";

const COLUMN_LIMITS = { open: 100, complete: 50, invoiced: 20 } as const;

function fmtPounds(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

// Plain-English age: hours under a day, days after.
function ageLabel(iso: string, now: Date): { text: string; days: number } {
  const ms = now.getTime() - new Date(iso).getTime();
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  const days = Math.floor(hours / 24);
  return { text: days >= 1 ? `${days}d` : `${hours}h`, days: ms / 86_400_000 };
}

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
  const openJobs = openRes.data ?? [];
  const unbilledJobs = completeRes.data ?? [];
  const invoicedJobs = invoicedRes.data ?? [];

  // Job £ value = sum of its line items (cheapest correct source — no schema
  // change). One query covers every card on the board.
  const allIds = [...openJobs, ...unbilledJobs, ...invoicedJobs].map((j) => j.id);
  const valueByJob = new Map<string, number>();
  const invoiceByJob = new Map<string, { id: string; total: number; created_at: string }>();
  if (allIds.length > 0) {
    const [itemsRes, invRes] = await Promise.all([
      admin.from("job_items").select("job_id, quantity, unit_price").in("job_id", allIds),
      invoicedJobs.length > 0
        ? admin
            .from("invoices")
            .select("id, job_id, total, created_at")
            .in("job_id", invoicedJobs.map((j) => j.id))
        : Promise.resolve({ data: [] as { id: string; job_id: string | null; total: number; created_at: string }[] }),
    ]);
    for (const it of (itemsRes.data ?? []) as { job_id: string; quantity: number; unit_price: number }[]) {
      valueByJob.set(it.job_id, (valueByJob.get(it.job_id) ?? 0) + it.quantity * it.unit_price);
    }
    for (const inv of (invRes.data ?? []) as { id: string; job_id: string | null; total: number; created_at: string }[]) {
      if (inv.job_id) invoiceByJob.set(inv.job_id, inv);
    }
  }

  const now = new Date();
  const jobValue = (j: JobRow) => valueByJob.get(j.id) ?? 0;
  const wipTotal = openJobs.reduce((s, j) => s + jobValue(j), 0);
  const waitingTotal = unbilledJobs.reduce((s, j) => s + jobValue(j), 0);

  // "This wk" = invoices raised since Monday (garage timezone).
  const todayKey = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const [y, m, d] = todayKey.split("-").map(Number);
  const monday = new Date(y, m - 1, d - ((new Date(y, m - 1, d).getDay() + 6) % 7));
  const weekTotal = invoicedJobs.reduce((s, j) => {
    const inv = invoiceByJob.get(j.id);
    return inv && new Date(inv.created_at) >= monday ? s + Number(inv.total) : s;
  }, 0);

  const nameMap = new Map(staff.map((s) => [s.id, s.name]));
  const filtered = Boolean(query || assignee);

  const columns = [
    {
      key: "open" as const,
      label: "In progress",
      labelClass: "text-ws-amber",
      accent: "border-l-ws-amber",
      surface: "bg-ws-card border-ws-border",
      total: `${fmtPounds(wipTotal)} WIP`,
      totalClass: "text-ws-text-2",
      jobs: openJobs,
      empty: filtered ? "// NO MATCHING OPEN JOBS" : "// NOTHING ON THE FLOOR",
    },
    {
      key: "complete" as const,
      label: "Done · unbilled",
      labelClass: "text-ws-amber",
      accent: "border-l-ws-amber",
      surface: "bg-[#17130c] border-ws-amber-border",
      total: `${fmtPounds(waitingTotal)} WAITING`,
      totalClass: "text-ws-amber",
      jobs: unbilledJobs,
      empty: filtered ? "// NO MATCHING COMPLETED JOBS" : "// NOTHING AWAITING AN INVOICE",
    },
    {
      key: "invoiced" as const,
      label: "Invoiced",
      labelClass: "text-ws-green",
      accent: "border-l-ws-green",
      surface: "bg-ws-card border-ws-border",
      total: `${fmtPounds(weekTotal)} THIS WK`,
      totalClass: "text-ws-text-2",
      jobs: invoicedJobs,
      empty: filtered ? "// NO MATCHING INVOICED JOBS" : "// NO INVOICED JOBS YET",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <MicroLabel>Jobs · {ctx.organization.name}</MicroLabel>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.01em] text-ws-text">
            Workshop floor
          </h1>
        </div>
        <JobFilters initialQ={query} staff={staff} assignee={assignee} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {columns.map((col) => (
          <section
            key={col.key}
            className={`rounded-[6px] border border-l-[3px] ${col.accent} ${col.surface}`}
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-ws-border px-4 py-3">
              <h2 className={`font-mono text-[10px] font-semibold uppercase tracking-[0.12em] ${col.labelClass}`}>
                {col.label} · {col.jobs.length}
              </h2>
              <span className={`font-mono text-[11px] font-semibold ${col.totalClass}`}>
                {col.total}
              </span>
            </header>
            {col.jobs.length === 0 ? (
              <p className="px-4 py-8 text-center font-mono text-xs text-ws-text-3">{col.empty}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-2 p-2.5">
                  {col.jobs.map((job) => (
                    <li key={job.id}>
                      <JobCard
                        job={job}
                        column={col.key}
                        value={jobValue(job)}
                        invoice={invoiceByJob.get(job.id) ?? null}
                        technician={job.assigned_to ? (nameMap.get(job.assigned_to) ?? null) : null}
                        now={now}
                      />
                    </li>
                  ))}
                </ul>
                {col.jobs.length === COLUMN_LIMITS[col.key] && (
                  <p className="border-t border-ws-border px-4 py-2 text-center font-mono text-[10px] text-ws-text-3">
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

function AgingDot({ days }: { days: number }) {
  const cls = days < 1 ? "bg-ws-green" : days <= 7 ? "bg-ws-amber" : "bg-ws-red";
  return <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${cls}`} aria-hidden />;
}

function JobCard({
  job,
  column,
  value,
  invoice,
  technician,
  now,
}: {
  job: JobRow;
  column: "open" | "complete" | "invoiced";
  value: number;
  invoice: { id: string; total: number; created_at: string } | null;
  technician: string | null;
  now: Date;
}) {
  const vehicleDesc = [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(" ");
  const ageSource = column === "open" ? job.created_at : (job.completed_at ?? job.created_at);
  const age = ageLabel(ageSource, now);

  // Footer age/value line + escalation tones (unbilled ≥5d nags, ≥7d alarms).
  let footer: string;
  let footerClass = "text-ws-text-3";
  let cardBorder = "border-ws-border";
  if (column === "open") {
    footer = `on floor ${age.text} · ${fmtPounds(value)}`;
  } else if (column === "complete") {
    footer = `done ${age.text} ago · ${fmtPounds(value)}`;
    if (age.days >= 7) {
      footerClass = "text-ws-red";
      cardBorder = "border-ws-red-border";
    } else if (age.days >= 5) {
      footer = `done ${age.text} ago — stuck? · ${fmtPounds(value)}`;
      footerClass = "text-ws-amber";
    }
  } else {
    const invDate = invoice
      ? new Date(invoice.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" })
      : "—";
    footer = `invoiced ${invDate} · ${fmtPounds(invoice ? Number(invoice.total) : value)}`;
  }

  return (
    <div
      className={`relative rounded-[4px] border bg-ws-hover p-3 transition-colors hover:border-[#3a4049] ${cardBorder} ${
        column === "invoiced" ? "opacity-75" : ""
      }`}
    >
      {/* Whole card opens the job; action chips sit above the overlay. */}
      <Link href={`/staff/jobs/${job.id}`} className="absolute inset-0" aria-label={job.description ?? "Job"} />

      <div className="flex items-center gap-2">
        {job.vehicle?.registration && <Plate reg={job.vehicle.registration} />}
        {job.is_demo && <DemoChip />}
        {job.high_voltage && <WorkshopBadge tone="amber">⚡ HV</WorkshopBadge>}
        <span className="ml-auto flex items-center">
          <AgingDot days={age.days} />
        </span>
      </div>

      <div className="mt-2 text-[13px] font-semibold leading-snug text-ws-text">
        {job.description || "Untitled job"}
      </div>
      <div className="mt-0.5 text-[11px] text-ws-text-2">
        {job.customer?.full_name ?? "—"}
        {vehicleDesc ? ` · ${vehicleDesc}` : ""}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] ${footerClass}`}>{footer}</span>
        {column === "complete" ? (
          <InvoiceButton jobId={job.id} />
        ) : column === "invoiced" ? (
          <Link
            href={invoice ? `/staff/invoices/${invoice.id}` : `/staff/jobs/${job.id}`}
            className="relative z-10 border-b border-[#3a4049] font-mono text-[10px] font-medium text-ws-text-2 transition-colors hover:text-ws-text"
          >
            view →
          </Link>
        ) : technician ? (
          <span className="rounded-[2px] border border-ws-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ws-text-2">
            {technician.split(/\s+/)[0]}
          </span>
        ) : null}
      </div>
    </div>
  );
}
