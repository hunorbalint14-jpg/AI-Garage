import Link from "next/link";
import { Check } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyQuoteAccess } from "@/lib/quote-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DepositSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t: token } = await searchParams;

  // Status here is "approved" because the customer already clicked Approve.
  // Stripe webhook handles the actual deposit_paid_at + items application.
  const verify = await verifyQuoteAccess(slug, token ?? null, ["approved"]);
  if (!verify.ok) {
    return (
      <main className="min-h-screen w-full grid place-items-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-lg border bg-white p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Link expired</h1>
          <p className="text-sm text-slate-600">If you completed payment, the garage has been notified. Otherwise, contact them directly.</p>
        </div>
      </main>
    );
  }

  // Read deposit state for the confirmation copy.
  const admin = createAdminClient();
  const { data } = await admin
    .from("job_quotes")
    .select("deposit_paid_at, deposit_amount, location:locations(name, phone, organization:organizations(name))")
    .eq("id", verify.quote.id)
    .maybeSingle();
  type Row = {
    deposit_paid_at: string | null;
    deposit_amount: number | null;
    location: { name: string; phone: string | null; organization: { name: string } | null } | null;
  };
  const row = data as Row | null;
  const garageName = row?.location?.organization?.name ?? row?.location?.name ?? "the garage";
  const formatGBP = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

  return (
    <main className="min-h-screen w-full grid place-items-center bg-slate-50 px-4">
      <div className="max-w-md w-full rounded-lg border bg-white p-8 text-center">
        <Check className="h-12 w-12 mx-auto text-green-600 mb-2" />
        <h1 className="text-2xl font-bold mb-2">Deposit received</h1>
        <p className="text-sm text-slate-600 mb-4">
          {row?.deposit_paid_at
            ? `Your ${row.deposit_amount ? formatGBP(row.deposit_amount) + " " : ""}deposit has been received and ${garageName} is continuing the work.`
            : `Your payment is processing. ${garageName} will be notified once Stripe confirms — typically within a minute.`}
        </p>
        {row?.location?.phone && (
          <p className="text-xs text-slate-500">Any questions? <Link href={`tel:${row.location.phone}`} className="underline">{row.location.phone}</Link></p>
        )}
      </div>
    </main>
  );
}
