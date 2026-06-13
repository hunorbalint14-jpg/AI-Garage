import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { agreementText } from "@/lib/courtesy-agreement";
import { createPhotoReadUrls } from "@/lib/courtesy-photos";
import { FleetSection, type CourtesyCarView, type OpenJobView } from "./fleet-section";
import { LoansSection, type LoanView } from "./loans-section";

export const dynamic = "force-dynamic";

export default async function CourtesyCarsPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [carsRes, loansRes, jobsRes] = await Promise.all([
    admin
      .from("courtesy_cars")
      .select("id, registration, make, model, notes, active")
      .eq("location_id", ctx.location.id)
      .order("registration"),
    admin
      .from("courtesy_car_loans")
      .select(
        "id, car_id, job_id, loaned_at, due_back_at, returned_at, fuel_out, fuel_in, odometer_out, odometer_in, condition_out, condition_in, licence_share_code, agreement_name, photos_out, photos_in, signature_url, customer:customers(id, full_name, phone), car:courtesy_cars(registration, make, model)",
      )
      .eq("location_id", ctx.location.id)
      .order("loaned_at", { ascending: false })
      .limit(60),
    admin
      .from("jobs")
      .select("id, customer_id, description, vehicle:vehicles(registration)")
      .eq("location_id", ctx.location.id)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const cars = (carsRes.data ?? []) as CourtesyCarView[];

  type LoanRow = {
    id: string;
    car_id: string;
    job_id: string | null;
    loaned_at: string;
    due_back_at: string | null;
    returned_at: string | null;
    fuel_out: number | null;
    fuel_in: number | null;
    odometer_out: number | null;
    odometer_in: number | null;
    condition_out: string | null;
    condition_in: string | null;
    licence_share_code: string | null;
    agreement_name: string | null;
    photos_out: string[] | null;
    photos_in: string[] | null;
    signature_url: string | null;
    customer: { id: string; full_name: string | null; phone: string | null } | null;
    car: { registration: string; make: string | null; model: string | null } | null;
  };
  const loanRows = (loansRes.data ?? []) as unknown as LoanRow[];

  // One batched signed-URL mint for every photo and signature on the page.
  const allPaths = loanRows.flatMap((l) => [
    ...(l.photos_out ?? []),
    ...(l.photos_in ?? []),
    ...(l.signature_url ? [l.signature_url] : []),
  ]);
  const photoUrls = await createPhotoReadUrls(allPaths);
  const resolve = (paths: string[] | null) =>
    (paths ?? []).map((p) => photoUrls.get(p)).filter((u): u is string => !!u);

  const loans: LoanView[] = loanRows.map((l) => ({
    id: l.id,
    carId: l.car_id,
    jobId: l.job_id,
    carLabel: l.car
      ? `${l.car.registration}${l.car.make ? ` — ${[l.car.make, l.car.model].filter(Boolean).join(" ")}` : ""}`
      : "—",
    customerName: l.customer?.full_name ?? "—",
    customerPhone: l.customer?.phone ?? null,
    loanedAt: l.loaned_at,
    dueBackAt: l.due_back_at,
    returnedAt: l.returned_at,
    fuelOut: l.fuel_out,
    fuelIn: l.fuel_in,
    odometerOut: l.odometer_out,
    odometerIn: l.odometer_in,
    conditionOut: l.condition_out,
    conditionIn: l.condition_in,
    licenceShareCode: l.licence_share_code,
    agreementName: l.agreement_name,
    photoUrlsOut: resolve(l.photos_out),
    photoUrlsIn: resolve(l.photos_in),
    signatureUrl: l.signature_url ? (photoUrls.get(l.signature_url) ?? null) : null,
  }));

  type JobRow = {
    id: string;
    customer_id: string | null;
    description: string | null;
    vehicle: { registration: string } | null;
  };
  const openJobs: OpenJobView[] = ((jobsRes.data ?? []) as unknown as JobRow[])
    .filter((j) => j.customer_id)
    .map((j) => ({
      id: j.id,
      customerId: j.customer_id!,
      label: `${j.vehicle?.registration ?? "No reg"} — ${(j.description ?? "Job").slice(0, 60)}`,
    }));

  const openLoanCarIds = new Set(loans.filter((l) => !l.returnedAt).map((l) => l.carId));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Courtesy cars"
        description="Loan diary with fuel and condition checks, a signed digital agreement, and DVLA licence share-code capture."
      />

      <FleetSection
        cars={cars}
        openLoanCarIds={[...openLoanCarIds]}
        agreement={agreementText(ctx.organization.name)}
        openJobs={openJobs}
      />

      <LoansSection loans={loans} />
    </div>
  );
}
