import { verifyReviewAccess } from "@/lib/review-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReviewForm } from "./review-form";

export const dynamic = "force-dynamic";

type OrgBrand = { name: string; primary_color: string | null; logo_url: string | null };

function Shell({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 h-1 w-12 rounded-full" style={{ backgroundColor: accent }} />
        {children}
      </div>
    </div>
  );
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verify = await verifyReviewAccess(token);

  if (!verify.ok) {
    const responded = verify.reason === "already_responded";
    return (
      <Shell accent="#22c55e">
        <h1 className="text-lg font-semibold text-gray-900">
          {responded ? "Thanks — feedback already received" : "Link unavailable"}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {responded
            ? "You've already left feedback for this visit. We appreciate it!"
            : "This feedback link is invalid or has expired. If you'd still like to get in touch, please contact the garage directly."}
        </p>
      </Shell>
    );
  }

  const admin = createAdminClient();
  const { data: location } = (await admin
    .from("locations")
    .select("name, organization:organizations!organization_id(name, primary_color, logo_url)")
    .eq("id", verify.review.location_id)
    .maybeSingle()) as { data: { name: string; organization: OrgBrand | null } | null };

  const org = location?.organization;
  const garageName = org?.name ?? location?.name ?? "the garage";
  const accent = org?.primary_color ?? "#22c55e";

  return (
    <Shell accent={accent}>
      <div className="mb-5 flex items-center gap-3">
        {org?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logo_url} alt={garageName} className="h-8 w-auto object-contain" />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
            style={{ backgroundColor: accent }}
          >
            {garageName.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
          </div>
        )}
        <span className="text-sm font-semibold text-gray-900">{garageName}</span>
      </div>

      <h1 className="text-xl font-bold text-gray-900">How did we do?</h1>
      <p className="mb-5 mt-1 text-sm text-gray-600">
        Your feedback helps {garageName} keep improving. It only takes a few seconds.
      </p>

      <ReviewForm token={token} accent={accent} />
    </Shell>
  );
}
