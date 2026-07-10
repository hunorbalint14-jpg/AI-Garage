import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCheckAccess, type CheckVerifyReason } from "@/lib/inspection-links";
import { createInspectionReadUrls } from "@/lib/inspection-media";
import { logAudit } from "@/lib/audit";
import { CheckResponse, type PricedFinding } from "./check-response";

// eVHC customer report (#497 Phase 5). Token-gated, no login — the
// /quote/[slug] recipe. Green items render read-only (the trust builder);
// amber/red findings show photos + the AI customer summary; priced findings
// drive the linked unified quote's per-item approval via ./actions.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Org = { id: string; name: string; logo_url: string | null; primary_color: string | null; phone: string | null };

const REASON_COPY: Record<CheckVerifyReason, { title: string; body: string }> = {
  not_found: { title: "Report not found", body: "This link doesn't point to a valid health check report. Check the link or contact the garage." },
  bad_token: { title: "Invalid link", body: "This link is invalid or has been tampered with. Contact the garage for a new one." },
  wrong_status: { title: "Report unavailable", body: "This report isn't available yet. Contact the garage if you were expecting it." },
};

function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

export default async function CheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { slug } = await params;
  const { t: token } = await searchParams;

  const verify = await verifyCheckAccess(slug, token ?? null, ["sent"]);
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

  const admin = createAdminClient();
  const { data } = await admin
    .from("inspections")
    .select(
      "id, sent_at, job:jobs(customer:customers(full_name), vehicle:vehicles(registration, make, model, year)), location:locations(name, organization:organizations!organization_id(id, name, logo_url, primary_color, phone)), items:inspection_items(id, section, label, rag, note, customer_summary, sort_order, media:inspection_media(id, storage_path))",
    )
    .eq("id", verify.inspection.id)
    .maybeSingle();
  type Row = {
    id: string;
    sent_at: string | null;
    job: {
      customer: { full_name: string | null } | null;
      vehicle: { registration: string | null; make: string | null; model: string | null; year: number | null } | null;
    } | null;
    location: { name: string; organization: Org | null } | null;
    items: {
      id: string;
      section: string;
      label: string;
      rag: string;
      note: string | null;
      customer_summary: string | null;
      sort_order: number;
      media: { id: string; storage_path: string }[];
    }[];
  };
  const inspection = data as unknown as Row | null;
  if (!inspection) {
    return (
      <main className="min-h-screen w-full grid place-items-center bg-slate-50 px-4">
        <div className="max-w-md w-full rounded-lg border bg-white p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Report not found</h1>
          <p className="text-sm text-slate-600">Contact the garage for a new link.</p>
        </div>
      </main>
    );
  }

  const org = inspection.location?.organization ?? null;

  // Fire-and-forget view counter + audit. NB: supabase-js builders are lazy —
  // they only execute once .then() is called, so a bare `void rpc(...)` would
  // silently never run.
  void admin.rpc("inspections_increment_view", { p_id: inspection.id }).then(
    () => undefined,
    (err) => console.error("[check] view counter failed", err),
  );
  void logAudit({
    organizationId: org?.id ?? null,
    action: "inspection.view",
    entityType: "inspection",
    entityId: inspection.id,
    metadata: {},
  });

  // Linked findings-quote (pending → interactive approval; anything else →
  // static banner). quote_items carry the inspection_item_id backlink.
  type QuoteInfo = {
    id: string;
    status: string;
    vat_rate: number;
    expires_at: string | null;
    responded_at: string | null;
    items: { id: string; inspection_item_id: string | null; unit_price: number; quantity: number }[];
  } | null;
  let quote: QuoteInfo = null;
  if (verify.inspection.quote_id) {
    const { data: q } = await admin
      .from("quotes")
      .select("id, status, vat_rate, expires_at, responded_at, approved_item_ids")
      .eq("id", verify.inspection.quote_id)
      .maybeSingle();
    if (q) {
      const { data: qItems } = await admin
        .from("quote_items")
        .select("id, inspection_item_id, unit_price, quantity")
        .eq("quote_id", (q as { id: string }).id);
      quote = {
        ...(q as { id: string; status: string; vat_rate: number; expires_at: string | null; responded_at: string | null }),
        items: (qItems ?? []) as NonNullable<QuoteInfo>["items"],
      };
    }
  }

  const items = inspection.items.slice().sort((a, b) => a.sort_order - b.sort_order);
  const red = items.filter((i) => i.rag === "red");
  const amber = items.filter((i) => i.rag === "amber");
  const green = items.filter((i) => i.rag === "green");
  const advisories = items.filter((i) => i.rag === "red" || i.rag === "amber");

  const allPaths = advisories.flatMap((it) => it.media.map((m) => m.storage_path));
  const urlMap = await createInspectionReadUrls(allPaths);

  const priceByInspectionItem = new Map(
    (quote?.items ?? [])
      .filter((qi) => qi.inspection_item_id)
      .map((qi) => [qi.inspection_item_id!, { quoteItemId: qi.id, price: qi.quantity * qi.unit_price }]),
  );

  const garageName = org?.name ?? inspection.location?.name ?? "Your garage";
  const primary = org?.primary_color || "#22c55e";
  const customerName = inspection.job?.customer?.full_name?.split(" ")[0] ?? "there";
  const vehicle = inspection.job?.vehicle;
  const vehicleDesc = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.registration || "your vehicle"
    : "your vehicle";
  const checkedDate = inspection.sent_at
    ? new Date(inspection.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const ragChip = (rag: string) =>
    rag === "red"
      ? { label: "Urgent", cls: "bg-red-100 text-red-700 border-red-200" }
      : { label: "Advisory", cls: "bg-amber-100 text-amber-700 border-amber-200" };

  // Sections in first-appearance order, advisories first within the report.
  const sections = [...new Set(items.map((i) => i.section))];

  const pricedFindings: PricedFinding[] = advisories
    .filter((it) => priceByInspectionItem.has(it.id))
    .map((it) => ({
      inspectionItemId: it.id,
      quoteItemId: priceByInspectionItem.get(it.id)!.quoteItemId,
      label: it.label,
      price: priceByInspectionItem.get(it.id)!.price,
      rag: it.rag as "red" | "amber",
    }));

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

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        <section>
          <div className="text-xs font-mono uppercase tracking-wide text-slate-500 mb-1">Vehicle health check</div>
          <h1 className="text-2xl font-bold">
            {vehicleDesc}
            {vehicle?.registration && <span className="ml-2 align-middle rounded bg-slate-900 px-2 py-0.5 text-base font-mono text-yellow-300">{vehicle.registration}</span>}
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Hi {customerName} — here&apos;s what our technician found{checkedDate ? ` on ${checkedDate}` : ""}. Every item was
            checked and graded; photos show anything that needs attention.
          </p>
        </section>

        <section className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold tabular-nums text-red-600">{red.length}</div>
            <div className="text-xs text-slate-500">Urgent</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold tabular-nums text-amber-600">{amber.length}</div>
            <div className="text-xs text-slate-500">Advisory</div>
          </div>
          <div className="rounded-lg border bg-white p-3">
            <div className="text-2xl font-bold tabular-nums text-green-600">{green.length}</div>
            <div className="text-xs text-slate-500">Checked OK</div>
          </div>
        </section>

        {advisories.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">What needs attention</h2>
            {advisories.map((it) => {
              const chip = ragChip(it.rag);
              const priced = priceByInspectionItem.get(it.id);
              return (
                <article key={it.id} className="rounded-lg border bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-500">{it.section}</div>
                      <h3 className="text-sm font-semibold">{it.label}</h3>
                    </div>
                    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <p className="mt-2 text-sm whitespace-pre-wrap">{it.customer_summary?.trim() || it.note?.trim() || it.label}</p>
                  {it.media.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {it.media.map((m) => {
                        const src = urlMap.get(m.storage_path);
                        return src ? (
                          <a key={m.id} href={src} target="_blank" rel="noopener noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt={`${it.label} photo`} className="h-24 w-24 rounded-md border object-cover" />
                          </a>
                        ) : null;
                      })}
                    </div>
                  )}
                  {priced && (
                    <p className="mt-3 text-sm font-semibold tabular-nums" style={{ color: primary }}>
                      {formatGBP(priced.price)} <span className="font-normal text-slate-500">ex VAT — approve or decline below</span>
                    </p>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {quote && (
          <CheckResponse
            slug={slug}
            token={token ?? ""}
            primaryColor={primary}
            quoteStatus={quote.status}
            respondedAt={quote.responded_at}
            expiresAt={quote.expires_at}
            vatRate={Number(quote.vat_rate)}
            findings={pricedFindings}
            garagePhone={org?.phone ?? null}
          />
        )}

        <section className="rounded-lg border bg-white overflow-hidden">
          <div className="px-4 py-2 bg-slate-50 border-b text-xs font-medium uppercase tracking-wide text-slate-500">
            Checked and OK ({green.length})
          </div>
          <ul className="divide-y">
            {sections.map((section) => {
              const greens = green.filter((i) => i.section === section);
              if (greens.length === 0) return null;
              return (
                <li key={section} className="px-4 py-2.5">
                  <div className="text-xs text-slate-500 mb-1">{section}</div>
                  <ul className="flex flex-col gap-1">
                    {greens.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 text-sm">
                        <span className="text-green-600">✓</span> {i.label}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="text-center text-xs text-slate-500">
          Questions about this report? Contact {garageName}
          {org?.phone ? (
            <>
              {" "}on <a href={`tel:${org.phone}`} className="underline">{org.phone}</a>
            </>
          ) : null}
          .
        </p>
      </div>
    </main>
  );
}
