import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { agreementText } from "@/lib/courtesy-agreement";
import { FleetSection, type CourtesyCarView } from "./fleet-section";
import { LoansSection, type LoanView } from "./loans-section";

export const dynamic = "force-dynamic";

export default async function CourtesyCarsPage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const [carsRes, loansRes] = await Promise.all([
    admin
      .from("courtesy_cars")
      .select("id, registration, make, model, notes, active")
      .eq("location_id", ctx.location.id)
      .order("registration"),
    admin
      .from("courtesy_car_loans")
      .select(
        "id, car_id, loaned_at, due_back_at, returned_at, fuel_out, fuel_in, odometer_out, odometer_in, condition_out, condition_in, licence_share_code, agreement_name, customer:customers(id, full_name, phone), car:courtesy_cars(registration, make, model)",
      )
      .eq("location_id", ctx.location.id)
      .order("loaned_at", { ascending: false })
      .limit(60),
  ]);

  const cars = (carsRes.data ?? []) as CourtesyCarView[];

  type LoanRow = {
    id: string;
    car_id: string;
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
    customer: { id: string; full_name: string | null; phone: string | null } | null;
    car: { registration: string; make: string | null; model: string | null } | null;
  };
  const loans: LoanView[] = ((loansRes.data ?? []) as unknown as LoanRow[]).map((l) => ({
    id: l.id,
    carId: l.car_id,
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
      />

      <LoansSection loans={loans} />
    </div>
  );
}
