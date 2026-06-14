import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { WinBackList, type WinBackVehicle } from "./win-back-list";

// Vehicles flagged by the nightly MOT delta sync: a fresh MOT test appeared
// with no booking or job at this garage around the test date — the customer
// went elsewhere. Surface them for a re-engagement message before the
// relationship lapses for good.

export default async function WinBackPage() {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "campaigns")) redirect("/staff");

  const admin = createAdminClient();

  const { data } = await admin
    .from("vehicles")
    .select(
      "id, registration, make, model, year, mot_expiry, last_mot_test_date, moted_elsewhere_at, customer:customers!inner(id, full_name, email, phone, marketing_email_consent, marketing_sms_consent, anonymized_at)",
    )
    .eq("organization_id", ctx.organization.id)
    .not("moted_elsewhere_at", "is", null)
    .is("customers.anonymized_at", null)
    .order("moted_elsewhere_at", { ascending: false })
    .limit(200);

  type Row = {
    id: string;
    registration: string;
    make: string | null;
    model: string | null;
    year: number | null;
    mot_expiry: string | null;
    last_mot_test_date: string | null;
    moted_elsewhere_at: string;
    customer: {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
      marketing_email_consent: boolean;
      marketing_sms_consent: boolean;
    } | null;
  };

  const vehicles: WinBackVehicle[] = ((data ?? []) as unknown as Row[])
    .filter((v) => v.customer)
    .map((v) => ({
      vehicleId: v.id,
      registration: v.registration,
      make: v.make,
      model: v.model,
      year: v.year,
      motExpiry: v.mot_expiry,
      lastMotTestDate: v.last_mot_test_date,
      flaggedAt: v.moted_elsewhere_at,
      customerId: v.customer!.id,
      customerName: v.customer!.full_name,
      hasEmail: Boolean(v.customer!.email),
      hasPhone: Boolean(v.customer!.phone),
      emailConsent: v.customer!.marketing_email_consent,
      smsConsent: v.customer!.marketing_sms_consent,
    }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Win-back"
        description="Customers whose vehicle was MOT'd recently without a visit here. Send a friendly re-engagement message before they drift to another garage."
      />
      <WinBackList vehicles={vehicles} />
    </div>
  );
}
