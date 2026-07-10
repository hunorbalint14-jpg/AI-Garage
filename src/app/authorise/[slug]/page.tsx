import { createAdminClient } from "@/lib/supabase/admin";
import { verifyReauthAccess, latestAuthorisation, type ReauthVerifyReason } from "@/lib/work-auth";
import { ReauthResponse } from "./reauth-response";

// Re-authorisation page (#503 PR 4). Token-gated, no login — the customer
// reviews the UPDATED itemised total (new items flagged, delta vs what they
// previously authorised shown up front) and approves or declines.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASON_COPY: Record<ReauthVerifyReason, { title: string; body: string }> = {
  not_found: { title: "Request not found", body: "This link doesn't point to a valid authorisation request. Contact the garage." },
  bad_token: { title: "Invalid link", body: "This link is invalid or has been superseded by a newer request. Contact the garage." },
  responded: { title: "Already answered", body: "You've already responded to this request — thank you! Contact the garage with any questions." },
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export default async function ReauthPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t: token } = await searchParams;

  const verify = await verifyReauthAccess(slug, token ?? null);
  if (!verify.ok) {
    const { title, body } = REASON_COPY[verify.reason];
    return (
      <main className="min-h-screen w-full grid place-items-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-lg border bg-white p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">{title}</h1>
          <p className="text-sm text-slate-600">{body}</p>
        </div>
      </main>
    );
  }
  const auth = verify.auth;

  const admin = createAdminClient();
  const [{ data: locRow }, previous] = await Promise.all([
    admin
      .from("locations")
      .select("name, organization:organizations!organization_id(name, logo_url, primary_color, phone)")
      .eq("id", auth.location_id)
      .maybeSingle(),
    auth.job_id ? latestAuthorisation(admin, auth.job_id) : Promise.resolve(null),
  ]);
  const loc = locRow as unknown as {
    name: string;
    organization: { name: string; logo_url: string | null; primary_color: string | null; phone: string | null } | null;
  } | null;
  const org = loc?.organization ?? null;
  const garageName = org?.name ?? loc?.name ?? "Your garage";
  const primary = org?.primary_color || "#22c55e";

  const { data: cust } = auth.customer_id
    ? await admin.from("customers").select("full_name").eq("id", auth.customer_id).maybeSingle()
    : { data: null };
  const firstName = (cust as { full_name: string | null } | null)?.full_name?.split(" ")[0] ?? "there";

  const prevTotal = previous ? Number(previous.authorised_total) : null;
  const delta = prevTotal !== null ? Math.round((auth.authorised_total - prevTotal) * 100) / 100 : null;
  // New-item flagging: anything not in the previously authorised snapshot.
  const prevDescriptions = new Set<string>();
  if (previous) {
    const { data: prevRow } = await admin
      .from("work_authorisations")
      .select("items_snapshot")
      .eq("id", previous.id)
      .maybeSingle();
    const prevItems = ((prevRow as { items_snapshot: { description: string }[] } | null)?.items_snapshot ?? []);
    for (const it of prevItems) prevDescriptions.add(it.description.trim().toLowerCase());
  }

  return (
    <main className="min-h-screen w-full text-slate-900" style={{ background: "#f8fafc" }}>
      <header className="bg-white border-b">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          {org?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt={garageName} className="h-10 w-auto" />
          )}
          <div>
            <div className="text-sm font-semibold">{garageName}</div>
            {org?.phone && (
              <a href={`tel:${org.phone}`} className="text-xs text-slate-500">{org.phone}</a>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
        <section>
          <div className="text-xs font-mono uppercase tracking-wide text-slate-500 mb-1">Updated authorisation needed</div>
          <h1 className="text-2xl font-bold">The work needs your OK to continue</h1>
          <p className="text-sm text-slate-600 mt-1">
            Hi {firstName} — the job needs more than first authorised. Nothing extra happens until you decide.
          </p>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              {prevTotal !== null && (
                <p className="text-sm text-slate-500">
                  Previously authorised <span className="tabular-nums line-through">{formatGBP(prevTotal)}</span>
                </p>
              )}
              <p className="text-2xl font-bold tabular-nums" style={{ color: primary }}>
                {formatGBP(auth.authorised_total)}
              </p>
            </div>
            {delta !== null && delta > 0 && (
              <span className="rounded-md bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-700 tabular-nums">
                +{formatGBP(delta)}
              </span>
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-white overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium uppercase tracking-wide text-slate-500">
            Updated itemised total
          </div>
          <table className="w-full text-sm">
            <tbody>
              {auth.items_snapshot.map((it, i) => {
                const isNew = previous !== null && !prevDescriptions.has(it.description.trim().toLowerCase());
                return (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-4 py-2">
                      {it.description}
                      {isNew && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                      {it.quantity} × {formatGBP(it.unit_price)}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-2">Total (inc. VAT)</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatGBP(auth.authorised_total)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {auth.terms_snapshot && (
          <section className="rounded-lg border bg-white p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Terms</div>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-slate-600">{auth.terms_snapshot}</p>
          </section>
        )}

        <ReauthResponse
          slug={slug}
          token={token ?? ""}
          primaryColor={primary}
          total={auth.authorised_total}
          garagePhone={org?.phone ?? null}
        />
      </div>
    </main>
  );
}
