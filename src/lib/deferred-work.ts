import { createAdminClient } from "@/lib/supabase/admin";

// Deferred-work bank (#498, docs/deferred-followup-build-spec.md). One
// snapshot row per outstanding repair in public.deferred_work — created from
// the quote-decline / partial-approval / report-send paths, consumed by the
// "Previously advised" panels and (Phase 3) the follow-up sequence.
//
// Dedupe invariant: one OPEN row per (vehicle, lower(description)). Banking
// the same repair again refreshes the existing row (price, refs, created_at)
// and restarts its follow-up clock instead of stacking a duplicate.

export type DeferredFinding = {
  id: string;
  vehicleId: string | null;
  description: string;
  price: number | null;
  rag: "amber" | "red" | null;
  /** declined = customer said no; not_quoted = advised but never priced. */
  kind: "declined" | "not_quoted";
  source: "quote_item" | "inspection_item";
  jobId: string | null;
  foundAt: string;
};

export type BankCandidate = {
  locationId: string;
  customerId: string | null;
  vehicleId: string | null;
  jobId: string | null;
  source: "quote_item" | "inspection_item";
  quoteItemId: string | null;
  inspectionItemId: string | null;
  description: string;
  price: number | null;
  rag: "amber" | "red" | null;
};

type Admin = ReturnType<typeof createAdminClient>;

type ExistingOpenRow = { id: string; vehicle_id: string | null; description: string };

// Pure half (unit-tested): which candidates update an existing open row and
// which insert. Key = (vehicle, lower(description)); candidates that collide
// with each other keep the first occurrence.
export function planBankUpserts(
  existing: ExistingOpenRow[],
  candidates: BankCandidate[],
): { updates: { id: string; candidate: BankCandidate }[]; inserts: BankCandidate[] } {
  const key = (vehicleId: string | null, description: string) =>
    `${vehicleId ?? "-"}|${description.trim().toLowerCase()}`;
  const byKey = new Map(existing.map((r) => [key(r.vehicle_id, r.description), r.id]));
  const seen = new Set<string>();
  const updates: { id: string; candidate: BankCandidate }[] = [];
  const inserts: BankCandidate[] = [];
  for (const c of candidates) {
    const description = c.description.trim();
    if (!description) continue;
    const k = key(c.vehicleId, description);
    if (seen.has(k)) continue;
    seen.add(k);
    const existingId = byKey.get(k);
    if (existingId) updates.push({ id: existingId, candidate: c });
    else inserts.push(c);
  }
  return { updates, inserts };
}

async function upsertCandidates(admin: Admin, candidates: BankCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;

  const vehicleIds = [...new Set(candidates.map((c) => c.vehicleId).filter((v): v is string => !!v))];
  const customerIds = [...new Set(candidates.map((c) => c.customerId).filter((v): v is string => !!v))];
  let query = admin.from("deferred_work").select("id, vehicle_id, description").eq("status", "open");
  // Existing-row scan scoped to the affected vehicles (or, for vehicle-less
  // standalone quotes, the affected customers).
  if (vehicleIds.length > 0 && customerIds.length > 0) {
    query = query.or(
      `vehicle_id.in.(${vehicleIds.join(",")}),customer_id.in.(${customerIds.join(",")})`,
    );
  } else if (vehicleIds.length > 0) {
    query = query.in("vehicle_id", vehicleIds);
  } else if (customerIds.length > 0) {
    query = query.in("customer_id", customerIds);
  } else {
    return 0; // nothing attributable to a customer or vehicle — skip
  }
  const { data: existing } = await query;

  const { updates, inserts } = planBankUpserts((existing ?? []) as ExistingOpenRow[], candidates);

  const now = new Date().toISOString();
  for (const u of updates) {
    // Refresh: new decline date restarts the follow-up clock.
    await admin
      .from("deferred_work")
      .update({
        price: u.candidate.price,
        rag: u.candidate.rag,
        job_id: u.candidate.jobId,
        quote_item_id: u.candidate.quoteItemId,
        inspection_item_id: u.candidate.inspectionItemId,
        source: u.candidate.source,
        followup_count: 0,
        last_followup_at: null,
        created_at: now,
        updated_at: now,
      })
      .eq("id", u.id)
      .eq("status", "open");
  }
  if (inserts.length > 0) {
    await admin.from("deferred_work").insert(
      inserts.map((c) => ({
        location_id: c.locationId,
        customer_id: c.customerId,
        vehicle_id: c.vehicleId,
        job_id: c.jobId,
        source: c.source,
        quote_item_id: c.quoteItemId,
        inspection_item_id: c.inspectionItemId,
        description: c.description.trim(),
        price: c.price,
        rag: c.rag,
      })),
    );
  }
  return updates.length + inserts.length;
}

// Bank a quote's lines (all of them, or all except the approved ones).
// Called from the decline and partial-approval paths — never throws to the
// caller's flow; the caller wraps in try/catch.
export async function bankQuoteLines(
  admin: Admin,
  quoteId: string,
  opts?: { excludeQuoteItemIds?: string[] },
): Promise<number> {
  const { data: q } = await admin
    .from("quotes")
    .select("id, location_id, job_id, customer_id, vehicle_id, job:jobs(customer_id, vehicle_id)")
    .eq("id", quoteId)
    .maybeSingle();
  const quote = q as unknown as {
    id: string;
    location_id: string;
    job_id: string | null;
    customer_id: string | null;
    vehicle_id: string | null;
    job: { customer_id: string | null; vehicle_id: string | null } | null;
  } | null;
  if (!quote) return 0;

  const { data: lines } = await admin
    .from("quote_items")
    .select("id, description, quantity, unit_price, inspection_item_id, finding:inspection_items(rag, suggested_repair, label)")
    .eq("quote_id", quoteId);
  const rows = (lines ?? []) as unknown as {
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    inspection_item_id: string | null;
    finding: { rag: string; suggested_repair: string | null; label: string } | null;
  }[];

  const exclude = new Set(opts?.excludeQuoteItemIds ?? []);
  const customerId = quote.customer_id ?? quote.job?.customer_id ?? null;
  const vehicleId = quote.vehicle_id ?? quote.job?.vehicle_id ?? null;

  const candidates: BankCandidate[] = rows
    .filter((r) => !exclude.has(r.id))
    .map((r) => ({
      locationId: quote.location_id,
      customerId,
      vehicleId,
      jobId: quote.job_id,
      source: "quote_item" as const,
      quoteItemId: r.id,
      inspectionItemId: r.inspection_item_id,
      // Short repair-line label when the line prices a finding; the raw line
      // description otherwise. Full customer wording stays on the sources.
      description: r.finding ? r.finding.suggested_repair?.trim() || r.finding.label : r.description,
      price: Math.round(r.quantity * r.unit_price * 100) / 100,
      rag: r.finding?.rag === "red" || r.finding?.rag === "amber" ? r.finding.rag : null,
    }));
  return upsertCandidates(admin, candidates);
}

// Bank an inspection's never-quoted amber/red findings (outcome 'none').
// Called when the report is sent — the customer has now been advised.
export async function bankInspectionFindings(admin: Admin, inspectionId: string): Promise<number> {
  const { data: i } = await admin
    .from("inspections")
    .select("id, location_id, vehicle_id, job_id, job:jobs(customer_id)")
    .eq("id", inspectionId)
    .maybeSingle();
  const inspection = i as unknown as {
    id: string;
    location_id: string;
    vehicle_id: string | null;
    job_id: string;
    job: { customer_id: string | null } | null;
  } | null;
  if (!inspection) return 0;

  const { data: items } = await admin
    .from("inspection_items")
    .select("id, label, suggested_repair, suggested_price, rag")
    .eq("inspection_id", inspectionId)
    .in("rag", ["amber", "red"])
    .eq("outcome", "none");
  const rows = (items ?? []) as {
    id: string;
    label: string;
    suggested_repair: string | null;
    suggested_price: number | null;
    rag: "amber" | "red";
  }[];

  const candidates: BankCandidate[] = rows.map((r) => ({
    locationId: inspection.location_id,
    customerId: inspection.job?.customer_id ?? null,
    vehicleId: inspection.vehicle_id,
    jobId: inspection.job_id,
    source: "inspection_item" as const,
    quoteItemId: null,
    inspectionItemId: r.id,
    description: r.suggested_repair?.trim() || r.label,
    price: r.suggested_price,
    rag: r.rag,
  }));
  return upsertCandidates(admin, candidates);
}

// Open records for a set of vehicles, newest first — the "Previously
// advised" panels (customer page + job card).
export async function deferredFindingsForVehicles(
  admin: Admin,
  vehicleIds: string[],
  opts?: { excludeJobId?: string; limitPerVehicle?: number },
): Promise<Map<string, DeferredFinding[]>> {
  const result = new Map<string, DeferredFinding[]>();
  if (vehicleIds.length === 0) return result;

  const { data } = await admin
    .from("deferred_work")
    .select("id, vehicle_id, job_id, source, description, price, rag, created_at")
    .in("vehicle_id", vehicleIds)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(400);
  const rows = (data ?? []) as {
    id: string;
    vehicle_id: string | null;
    job_id: string | null;
    source: "quote_item" | "inspection_item";
    description: string;
    price: number | null;
    rag: "amber" | "red" | null;
    created_at: string;
  }[];

  const limit = opts?.limitPerVehicle ?? 12;
  for (const r of rows) {
    if (!r.vehicle_id) continue;
    if (opts?.excludeJobId && r.job_id === opts.excludeJobId) continue;
    const list = result.get(r.vehicle_id) ?? [];
    if (list.length >= limit) continue;
    list.push({
      id: r.id,
      vehicleId: r.vehicle_id,
      description: r.description,
      price: r.price,
      rag: r.rag,
      kind: r.source === "quote_item" ? "declined" : "not_quoted",
      source: r.source,
      jobId: r.job_id,
      foundAt: r.created_at,
    });
    result.set(r.vehicle_id, list);
  }
  return result;
}
