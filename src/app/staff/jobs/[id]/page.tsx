import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { TechnicianSelector } from "@/components/staff/technician-selector";
import { assignJobTechnician } from "../actions";
import { JobDetail } from "./job-detail";

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

  const [jobRes, itemsRes, productsRes, quotesRes, staff] = await Promise.all([
    admin
      .from("jobs")
      .select(
        "id, status, description, notes, created_at, completed_at, location_id, booking_id, assigned_to, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model, year)",
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
      .from("job_quotes")
      .select(
        "id, status, title, total, created_at, sent_at, viewed_at, viewed_count, responded_at, expires_at, decline_reason",
      )
      .eq("job_id", id)
      .order("created_at", { ascending: false }),
    listLocationStaff(ctx.location.id, ctx.organization.id),
  ]);

  const job = jobRes.data as Job | null;
  if (!job || job.location_id !== ctx.location.id) notFound();

  const items = (itemsRes.data ?? []) as JobItem[];
  const products = (productsRes.data ?? []) as {
    id: string;
    name: string;
    unit_price: number;
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

      <JobDetail job={job} items={items} products={products} quotes={quotes} />
    </div>
  );
}
