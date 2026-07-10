import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { labourEstimateMinutes, liveActiveMinutes } from "@/lib/time-tracking";
import { TechnicianSelector } from "@/components/staff/technician-selector";
import { hvWarningFor, isHvQualified, qualExpired } from "@/lib/ev-readiness";
import { assignJobTechnician } from "../actions";
import { cachedActiveProducts, cachedActiveServices } from "@/lib/location-cache";
import { JobDetail } from "./job-detail";
import { InspectionCard, inspectionSummary } from "./inspection-card";
import { deferredFindingsForVehicles } from "@/lib/deferred-work";
import { DeferredWorkPanel } from "@/components/staff/deferred-work-panel";
import { latestAuthorisation } from "@/lib/work-auth";
import { AuthorisePanel, type ExistingAuth } from "./authorise-panel";

// Work-authorisation props (#503): current org terms + the newest artefact.
async function orgAuthorisationTerms(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("organizations")
    .select("authorisation_terms")
    .eq("id", organizationId)
    .maybeSingle();
  return (data as { authorisation_terms: string | null } | null)?.authorisation_terms ?? null;
}

async function existingAuthProp(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<ExistingAuth> {
  const auth = await latestAuthorisation(admin, jobId);
  return auth
    ? { id: auth.id, total: Number(auth.authorised_total), signedName: auth.signed_name, authorisedAt: auth.authorised_at }
    : null;
}
import { isFeatureEnabled } from "@/lib/feature-flags";
import { JobTimeTracking, type TimeEntryView } from "./job-time-tracking";
import { HighVoltageSection } from "./high-voltage-section";

type Job = {
  id: string;
  status: string;
  description: string | null;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  location_id: string;
  booking_id: string | null;
  assigned_to: string | null;
  high_voltage: boolean;
  customer: { id: string; full_name: string | null; email: string | null; phone: string | null } | null;
  vehicle: { id: string; registration: string; make: string | null; model: string | null; year: number | null } | null;
};

type JobItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  type: string;
  vat_rate: number;
  created_at: string;
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const evhcEnabled = await isFeatureEnabled("evhc");

  const [jobRes, itemsRes, products, cachedServices, quotesRes, staff, timeRes] = await Promise.all([
    admin
      .from("jobs")
      .select(
        "id, status, description, notes, created_at, completed_at, location_id, booking_id, assigned_to, high_voltage, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model, year)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("job_items")
      .select("id, description, quantity, unit_price, type, vat_rate, created_at")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
    cachedActiveProducts(ctx.location.id),
    cachedActiveServices(ctx.location.id),
    admin
      .from("quotes")
      .select(
        "id, status, title, total, created_at, sent_at, viewed_at, viewed_count, responded_at, expires_at, decline_reason",
      )
      .eq("job_id", id)
      .order("created_at", { ascending: false }),
    listLocationStaff(ctx.location.id, ctx.organization.id),
    admin
      .from("job_time_entries")
      .select("id, user_id, started_at, ended_at, duration_minutes, status, active_minutes, segment_started_at")
      .eq("job_id", id)
      .order("started_at", { ascending: true }),
  ]);

  const job = jobRes.data as Job | null;
  if (!job || job.location_id !== ctx.location.id) notFound();

  // HV qualification check for the warning banner (cheap: only when flagged).
  const { data: quals } = job.high_voltage
    ? await admin
        .from("location_users")
        .select("user_id, ev_level, ev_expires_at")
        .eq("location_id", ctx.location.id)
        .not("ev_level", "is", null)
    : { data: [] };
  type QualRow = { user_id: string; ev_level: number; ev_expires_at: string | null };
  const qualRows = (quals ?? []) as QualRow[];
  const assigneeQual = job.assigned_to
    ? (qualRows.find((q) => q.user_id === job.assigned_to) ?? null)
    : null;

  const items = (itemsRes.data ?? []) as JobItem[];
  const productOptions = products.map((p) => ({
    id: p.id,
    name: p.name,
    unit_price: p.unit_price,
    category: p.category ?? "",
  }));
  const services = cachedServices.map((s) => ({
    id: s.id,
    name: s.name,
    price: s.price,
    vat_included: s.vat_included !== false,
    vat_treatment: s.vat_treatment ?? "standard",
    category: s.category ?? "",
  }));
  const quotes = (quotesRes.data ?? []) as {
    id: string;
    status: string;
    title: string | null;
    total: number;
    created_at: string;
    sent_at: string | null;
    viewed_at: string | null;
    viewed_count: number;
    responded_at: string | null;
    expires_at: string;
    decline_reason: string | null;
  }[];

  // Time-tracking view: resolve worker names + compute active minutes now.
  const staffNames = new Map(staff.map((s) => [s.id, s.name]));
  const isManager = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const now = new Date().toISOString();
  const timeEntries: TimeEntryView[] = (
    (timeRes.data ?? []) as {
      id: string;
      user_id: string;
      duration_minutes: number | null;
      status: string;
      active_minutes: number;
      segment_started_at: string | null;
    }[]
  ).map((e) => ({
    id: e.id,
    userId: e.user_id,
    userName: staffNames.get(e.user_id) ?? "Staff",
    status: e.status,
    minutes: liveActiveMinutes(
      { status: e.status, active_minutes: e.active_minutes, segment_started_at: e.segment_started_at, duration_minutes: e.duration_minutes },
      now,
    ),
    canAdjust: e.user_id === ctx.user.id || isManager,
  }));
  const estimateMinutes = labourEstimateMinutes(items);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={job.booking_id ? `/staff/bookings/${job.booking_id}` : "/staff/bookings"}
          className="text-sm text-muted-foreground underline"
        >
          ← Back to {job.booking_id ? "booking" : "bookings"}
        </Link>
      </div>

      <section className="rounded-lg border p-4">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3 mb-3">
          Assigned technician
        </h2>
        <TechnicianSelector
          entityId={job.id}
          staff={staff}
          currentUserId={job.assigned_to}
          assignAction={assignJobTechnician}
        />
      </section>

      <HighVoltageSection
        jobId={job.id}
        initialHighVoltage={job.high_voltage}
        warning={hvWarningFor({
          highVoltage: job.high_voltage,
          assigneeName: job.assigned_to ? (staffNames.get(job.assigned_to) ?? "Assigned technician") : null,
          assigneeLevel: assigneeQual?.ev_level ?? null,
          assigneeExpiresAt: assigneeQual?.ev_expires_at ?? null,
          locationHasQualified: qualRows.some((q) => isHvQualified(q.ev_level) && !qualExpired(q.ev_expires_at)),
        })}
      />

      <JobTimeTracking
        jobId={job.id}
        entries={timeEntries}
        estimateMinutes={estimateMinutes}
        currentUserId={ctx.user.id}
      />

      <AuthorisePanel
        jobId={job.id}
        items={items.map((it) => ({
          description: it.description,
          type: it.type,
          quantity: it.quantity,
          unit_price: it.unit_price,
          vat_rate: it.vat_rate ?? 20,
        }))}
        terms={await orgAuthorisationTerms(admin, ctx.organization.id)}
        customerName={job.customer?.full_name ?? null}
        existing={await existingAuthProp(admin, job.id)}
      />

      {evhcEnabled && <InspectionCard jobId={job.id} summary={await inspectionSummary(admin, job.id)} />}

      {/* Outstanding advisories from EARLIER checks on this vehicle (#497
          Phase 6) — this job's own check is excluded. */}
      {evhcEnabled && job.vehicle && (
        <DeferredWorkPanel
          findings={(await deferredFindingsForVehicles(admin, [job.vehicle.id], { excludeJobId: job.id })).get(job.vehicle.id) ?? []}
        />
      )}

      <JobDetail job={job} items={items} products={productOptions} services={services} quotes={quotes} />
    </div>
  );
}
