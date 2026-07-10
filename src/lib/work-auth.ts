import { createAdminClient } from "@/lib/supabase/admin";

// Work authorisation helpers (#503). The artefact row is the legal record —
// items and terms are snapshotted as shown; these helpers keep the maths and
// storage recipes in one place.

// Pure maths + types live in work-auth-shared.ts (client-importable);
// re-exported here so server callers keep one import path.
export * from "@/lib/work-auth-shared";
import type { AuthItemSnapshot } from "@/lib/work-auth-shared";

export const SIGNATURE_BUCKET = "authorisation-signatures";
export const SIGNATURE_MAX_BYTES = 200 * 1024; // canvas PNGs are ~10–50 KB

export function signaturePath(locationId: string, jobId: string, authId: string): string {
  return `${locationId}/${jobId}/${authId}.png`;
}

export async function createSignatureReadUrl(path: string, expiresInSeconds = 1800): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.storage.from(SIGNATURE_BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

export type LatestAuthorisation = {
  id: string;
  kind: string;
  method: string;
  status: string;
  authorised_total: number;
  signed_name: string | null;
  authorised_at: string | null;
} | null;

// Newest AUTHORISED artefact for a job — what the variation check (PR 4) and
// the job-card chip compare against.
export async function latestAuthorisation(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<LatestAuthorisation> {
  const { data } = await admin
    .from("work_authorisations")
    .select("id, kind, method, status, authorised_total, signed_name, authorised_at")
    .eq("job_id", jobId)
    .eq("status", "authorised")
    .order("authorised_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as LatestAuthorisation) ?? null;
}

// Remote authorisation artefact (#503 PR 3): written when a customer
// approves a quote — via /quote/[slug] directly or the eVHC report, both of
// which land in approveQuote. Snapshots the APPROVED lines + the org terms;
// best-effort by contract (throws are caught here) — an artefact failure
// must never block an approval.
export async function recordQuoteAuthorisation(args: {
  quoteId: string;
  locationId: string;
  jobId: string | null;
  approvedItemIds: string[]; // empty = every line
  authorisedTotal: number; // inc VAT — the figure the customer clicked yes to
  signedName: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  try {
    const [{ data: quoteRow }, { data: lineRows }] = await Promise.all([
      admin
        .from("quotes")
        .select("id, organization_id, customer_id, vat_rate, job:jobs(customer_id)")
        .eq("id", args.quoteId)
        .maybeSingle(),
      admin
        .from("quote_items")
        .select("id, description, type, quantity, unit_price")
        .eq("quote_id", args.quoteId)
        .order("sort_order"),
    ]);
    const quote = quoteRow as unknown as {
      id: string;
      organization_id: string | null;
      customer_id: string | null;
      vat_rate: number;
      job: { customer_id: string | null } | null;
    } | null;
    if (!quote) return;

    const approved = new Set(args.approvedItemIds);
    const lines = ((lineRows ?? []) as { id: string; description: string; type: string; quantity: number; unit_price: number }[])
      .filter((l) => approved.size === 0 || approved.has(l.id));
    const items: AuthItemSnapshot[] = lines.map((l) => ({
      description: l.description,
      type: l.type,
      quantity: l.quantity,
      unit_price: l.unit_price,
      // Quotes are single-rate; snapshot it per line so the record reads the
      // same as counter artefacts.
      vat_rate: Number(quote.vat_rate) || 0,
    }));

    let terms: string | null = null;
    if (quote.organization_id) {
      const { data: org } = await admin
        .from("organizations")
        .select("authorisation_terms")
        .eq("id", quote.organization_id)
        .maybeSingle();
      terms = (org as { authorisation_terms: string | null } | null)?.authorisation_terms ?? null;
    }

    const kind = args.jobId && (await latestAuthorisation(admin, args.jobId)) ? "variation" : "initial";
    const { data: inserted, error } = await admin
      .from("work_authorisations")
      .insert({
        location_id: args.locationId,
        job_id: args.jobId,
        quote_id: args.quoteId,
        customer_id: quote.customer_id ?? quote.job?.customer_id ?? null,
        kind,
        method: "quote_approval",
        status: "authorised",
        authorised_total: args.authorisedTotal,
        items_snapshot: items,
        terms_snapshot: terms,
        signed_name: args.signedName?.trim().slice(0, 120) || null,
        ip: args.ip,
        user_agent: args.userAgent?.slice(0, 300) ?? null,
        authorised_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;

    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      organizationId: quote.organization_id,
      action: "authorisation.captured",
      entityType: "work_authorisation",
      entityId: (inserted as { id: string } | null)?.id ?? args.quoteId,
      metadata: { quote_id: args.quoteId, job_id: args.jobId, total: args.authorisedTotal, kind, method: "quote_approval" },
    });
  } catch (err) {
    console.error("[work-auth] quote artefact failed", err);
  }
}

// Decode a canvas PNG data URL by hand — never fetch(dataUrl), the CSP
// connect-src trap. Returns null unless it's a plausible small PNG.
export function decodeSignatureDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const buf = Buffer.from(m[1], "base64");
    if (buf.length === 0 || buf.length > SIGNATURE_MAX_BYTES) return null;
    // PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    return buf;
  } catch {
    return null;
  }
}
