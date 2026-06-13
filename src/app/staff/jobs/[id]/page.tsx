import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { labourEstimateMinutes, liveActiveMinutes } from "@/lib/time-tracking";
import { TechnicianSelector } from "@/components/staff/technician-selector";
import { hvWarningFor, isHvQualified, qualExpired } from "@/lib/ev-readiness";
import { assignJobTechnician } from "../actions";
import { JobDetail } from "./job-detail";
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

  const [jobRes, itemsRes, productsRes, servicesRes, quotesRes, staff, timeRes] = await Promise.all([
    admin
      .from("jobs")
      .select(
        "id, status, description, notes, created_at, completed_at, location_id, booking_id, assigned_to, high_voltage, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model, year)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("job_items")
      .select("id, description, quantity, unit_price, type, created_at")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
    admin
      .from("products")
      .select("id, name, unit_price, category")
      .eq("location_id", ctx.location.id)
      .eq("active", true)
      .order("name"),
    admin
      .from("services")
      .select("id, name, price, category")
      .eq("location_id", ctx.location.id)
      .eq("active", true)
      .order("name"),
    admin
      .from("job_quotes")
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
  const products = (productsRes.data ?? []) as {
    id: string;
    name: string;
    unit_price: number;
    category: string;
  }[];
  const services = (servicesRes.data ?? []) as {
    id: string;
    name: string;
    price: number | null;
    category: string;
  }[];
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
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
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

      <JobDetail job={job} items={items} products={products} services={services} quotes={quotes} />
    </div>
  );
}
