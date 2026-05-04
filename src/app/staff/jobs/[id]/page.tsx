import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const [jobRes, itemsRes] = await Promise.all([
    admin
      .from("jobs")
      .select(
        "id, status, description, notes, created_at, completed_at, location_id, booking_id, customer:customers(id, full_name, email, phone), vehicle:vehicles(id, registration, make, model, year)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("job_items")
      .select("id, description, quantity, unit_price, type, created_at")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const job = jobRes.data as Job | null;
  if (!job || job.location_id !== ctx.location.id) notFound();

  const items = (itemsRes.data ?? []) as JobItem[];

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

      <JobDetail job={job} items={items} />
    </div>
  );
}
