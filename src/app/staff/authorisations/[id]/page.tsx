import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSignatureReadUrl, type AuthItemSnapshot } from "@/lib/work-auth";
import { PrintButton } from "./print-button";

// Authorisation record view (#503 PR 2). Renders the IMMUTABLE snapshot —
// items, terms, signature, identity trail — exactly as stored. Print CSS
// stands in for a generated PDF (the artefact row is the legal record).

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

const METHOD_LABEL: Record<string, string> = {
  counter_signature: "Signed at the counter",
  quote_approval: "Approved via quote link",
  reauth_link: "Approved via re-authorisation link",
};

export default async function AuthorisationRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data } = await admin
    .from("work_authorisations")
    .select(
      "id, location_id, job_id, kind, method, status, authorised_total, items_snapshot, terms_snapshot, signature_path, signed_name, ip, user_agent, authorised_at, created_at, customer:customers(full_name), job:jobs(vehicle:vehicles(registration, make, model))",
    )
    .eq("id", id)
    .maybeSingle();
  type Row = {
    id: string;
    location_id: string;
    job_id: string | null;
    kind: string;
    method: string;
    status: string;
    authorised_total: number;
    items_snapshot: AuthItemSnapshot[];
    terms_snapshot: string | null;
    signature_path: string | null;
    signed_name: string | null;
    ip: string | null;
    user_agent: string | null;
    authorised_at: string | null;
    created_at: string;
    customer: { full_name: string | null } | null;
    job: { vehicle: { registration: string | null; make: string | null; model: string | null } | null } | null;
  };
  const auth = data as unknown as Row | null;
  if (!auth || auth.location_id !== ctx.location.id) notFound();

  const signatureUrl = auth.signature_path ? await createSignatureReadUrl(auth.signature_path) : null;
  const vehicle = auth.job?.vehicle;
  const vehicleLine = vehicle
    ? [vehicle.registration, [vehicle.make, vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")
    : null;
  const when = auth.authorised_at ?? auth.created_at;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 print:max-w-none">
      <div className="flex items-center justify-between gap-3 print:hidden">
        {auth.job_id ? (
          <Link href={`/staff/jobs/${auth.job_id}`} className="text-sm text-muted-foreground underline underline-offset-2">
            ← Back to the job
          </Link>
        ) : (
          <span />
        )}
        <PrintButton />
      </div>

      <div>
        <h1 className="text-2xl font-bold">Work authorisation record</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {ctx.organization.name} — {ctx.location.name}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border p-4 text-sm print:border-black/30">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="capitalize">{auth.status} · {auth.kind}</dd>
        <dt className="text-muted-foreground">Method</dt>
        <dd>{METHOD_LABEL[auth.method] ?? auth.method}</dd>
        <dt className="text-muted-foreground">Customer</dt>
        <dd>{auth.signed_name ?? auth.customer?.full_name ?? "—"}</dd>
        {vehicleLine && (
          <>
            <dt className="text-muted-foreground">Vehicle</dt>
            <dd className="font-mono">{vehicleLine}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Date & time</dt>
        <dd>
          {new Date(when).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </dd>
        {auth.ip && (
          <>
            <dt className="text-muted-foreground">IP address</dt>
            <dd className="font-mono text-xs">{auth.ip}</dd>
          </>
        )}
      </dl>

      <section className="rounded-lg border overflow-hidden print:border-black/30">
        <h2 className="border-b px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Authorised items (as shown at signing)
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {auth.items_snapshot.map((it, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <td className="px-4 py-2">
                  {it.description}
                  <span className="ml-1.5 text-xs text-muted-foreground capitalize">· {it.type}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {it.quantity} × {formatGBP(it.unit_price)}
                  {it.vat_rate === 0 ? " (no VAT)" : ""}
                </td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-semibold">
              <td className="px-4 py-2">Authorised total (inc. VAT)</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatGBP(Number(auth.authorised_total))}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {auth.terms_snapshot && (
        <section className="rounded-lg border p-4 print:border-black/30">
          <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
            Terms (as shown at signing)
          </h2>
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">{auth.terms_snapshot}</p>
        </section>
      )}

      {signatureUrl && (
        <section className="rounded-lg border p-4 print:border-black/30">
          <h2 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
            Signature
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signatureUrl} alt="Customer signature" className="h-28 rounded-md border bg-white object-contain px-3" />
          {auth.signed_name && <p className="mt-1.5 text-sm">{auth.signed_name}</p>}
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        This record is immutable: the items, total and terms above were captured at the moment of
        authorisation and are not affected by later changes to the job or the garage&apos;s terms.
      </p>
    </div>
  );
}
