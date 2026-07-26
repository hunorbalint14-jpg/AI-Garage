import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { onBrandColor } from "@/components/staff/staff-modules";
import {
  computeInsight,
  daysUntil,
  formatAgo,
  formatNextDue,
  dueUrgency,
  isSegmentKey,
  isSortKey,
  scanClock,
  SEGMENTS,
  type SegmentKey,
  type SortKey,
} from "@/lib/customer-insights";
import { type DeckRow } from "./customers-ui";
import { CustomersDeck } from "./customers-deck";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Segments, health and the default sort are derived, not stored — so the deck
 * has to score the whole book before it can filter or count. That is fine at
 * garage scale (hundreds to low thousands of records) but not unbounded: past
 * this many customers the scan covers the most recently added ones and the
 * header says so rather than quietly showing a partial picture.
 */
const SCAN_LIMIT = 4000;

/** Reminder engagement only informs the brief — a 6-month window is plenty. */
const REMINDER_WINDOW_DAYS = 180;
const REMINDER_LIMIT = 8000;

type CustomerRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
  is_demo: boolean;
  preferred_location_id: string | null;
  preferred_location: { name: string | null } | null;
};

type VehicleRow = {
  id: string;
  customer_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  mot_expiry: string | null;
  service_due: string | null;
  tax_due_date: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; branch?: string; sort?: string; segment?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { q, page: pageParam, branch: branchParam, sort: sortParam, segment: segmentParam } = await searchParams;

  const query = q?.trim() ?? "";
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // Only honour a branch the staffer can actually see; anything else = "all".
  const multiBranch = ctx.accessibleLocations.length > 1;
  const branch =
    branchParam && ctx.accessibleLocations.some((l) => l.id === branchParam) ? branchParam : "all";
  // Deliberate behaviour change vs. the old list: the deck opens on the people
  // who need something, not the most recently added.
  const sort: SortKey = isSortKey(sortParam) ? sortParam : "attention";
  const segment: SegmentKey = isSegmentKey(segmentParam) ? segmentParam : "all";

  const now = scanClock();
  const locationIds = ctx.accessibleLocations.map((l) => l.id);
  const reminderSince = new Date(now - REMINDER_WINDOW_DAYS * 86_400_000).toISOString();

  let customerQuery = admin
    .from("customers")
    .select(
      "id, full_name, email, phone, created_at, is_demo, preferred_location_id, preferred_location:locations(name)",
      { count: "exact" },
    )
    .eq("organization_id", ctx.organization.id);
  if (branch !== "all") customerQuery = customerQuery.eq("preferred_location_id", branch);

  const [customersRes, vehiclesRes, invoicesRes, jobsRes, subsRes, quotesRes, remindersRes] =
    await Promise.all([
      customerQuery.order("created_at", { ascending: false }).limit(SCAN_LIMIT),
      admin
        .from("vehicles")
        .select("id, customer_id, registration, make, model, mot_expiry, service_due, tax_due_date")
        .eq("organization_id", ctx.organization.id),
      admin
        .from("invoices")
        .select("customer_id, total, amount_paid, status, paid_at")
        .eq("organization_id", ctx.organization.id),
      // jobs are branch-scoped (no organization_id), so visits are counted
      // across every branch this staffer can act in.
      admin
        .from("jobs")
        .select("customer_id, status, completed_at")
        .in("location_id", locationIds)
        .eq("status", "complete"),
      admin
        .from("plan_subscriptions")
        .select("customer_id, status")
        .eq("organization_id", ctx.organization.id),
      admin
        .from("quotes")
        .select("id, customer_id, total, sent_at, job:jobs(customer_id)")
        .eq("organization_id", ctx.organization.id)
        .eq("status", "pending")
        .order("sent_at", { ascending: false, nullsFirst: false }),
      admin
        .from("reminders")
        .select("customer_id, sent_at, opened_at")
        .eq("organization_id", ctx.organization.id)
        .gte("sent_at", reminderSince)
        .order("sent_at", { ascending: false })
        .limit(REMINDER_LIMIT),
    ]);

  const error = customersRes.error;
  const customers = (customersRes.data ?? []) as unknown as CustomerRow[];
  const scannedTotal = customersRes.count ?? customers.length;
  const scanTruncated = scannedTotal > customers.length;

  // ── Fold the aggregate queries down to per-customer facts ────────────────
  const vehiclesByCustomer = new Map<string, VehicleRow[]>();
  for (const v of (vehiclesRes.data ?? []) as unknown as VehicleRow[]) {
    if (!v.customer_id) continue;
    const list = vehiclesByCustomer.get(v.customer_id);
    if (list) list.push(v);
    else vehiclesByCustomer.set(v.customer_id, [v]);
  }

  const balanceByCustomer = new Map<string, number>();
  const ltvByCustomer = new Map<string, number>();
  const lastPaidByCustomer = new Map<string, string>();
  for (const inv of (invoicesRes.data ?? []) as {
    customer_id: string | null;
    total: number;
    amount_paid: number | null;
    status: string;
    paid_at: string | null;
  }[]) {
    if (!inv.customer_id) continue;
    if (inv.status === "sent") {
      const open = Math.max(0, Number(inv.total) - Number(inv.amount_paid ?? 0));
      balanceByCustomer.set(inv.customer_id, (balanceByCustomer.get(inv.customer_id) ?? 0) + open);
    }
    if (inv.status === "paid") {
      ltvByCustomer.set(inv.customer_id, (ltvByCustomer.get(inv.customer_id) ?? 0) + Number(inv.total));
      if (inv.paid_at) {
        const prev = lastPaidByCustomer.get(inv.customer_id);
        if (!prev || inv.paid_at > prev) lastPaidByCustomer.set(inv.customer_id, inv.paid_at);
      }
    }
  }

  const visitsByCustomer = new Map<string, number>();
  const lastJobByCustomer = new Map<string, string>();
  for (const j of (jobsRes.data ?? []) as { customer_id: string | null; completed_at: string | null }[]) {
    if (!j.customer_id) continue;
    visitsByCustomer.set(j.customer_id, (visitsByCustomer.get(j.customer_id) ?? 0) + 1);
    if (j.completed_at) {
      const prev = lastJobByCustomer.get(j.customer_id);
      if (!prev || j.completed_at > prev) lastJobByCustomer.set(j.customer_id, j.completed_at);
    }
  }

  const LIVE_SUB = new Set(["active", "trialing", "past_due"]);
  const planCustomers = new Set(
    ((subsRes.data ?? []) as { customer_id: string | null; status: string }[])
      .filter((s) => s.customer_id && LIVE_SUB.has(s.status))
      .map((s) => s.customer_id as string),
  );

  // Newest pending quote per customer — job-type quotes reach the customer
  // through their parent job, standalone ones carry customer_id directly.
  const openQuoteByCustomer = new Map<string, { id: string; total: number; sentAt: string | null }>();
  for (const quote of (quotesRes.data ?? []) as unknown as {
    id: string;
    customer_id: string | null;
    total: number;
    sent_at: string | null;
    job: { customer_id: string | null } | null;
  }[]) {
    const customerId = quote.customer_id ?? quote.job?.customer_id ?? null;
    if (!customerId || openQuoteByCustomer.has(customerId)) continue;
    openQuoteByCustomer.set(customerId, { id: quote.id, total: Number(quote.total), sentAt: quote.sent_at });
  }

  const reminderStats = new Map<string, { sent: number; opened: number; lastAt: string | null }>();
  for (const r of (remindersRes.data ?? []) as {
    customer_id: string | null;
    sent_at: string;
    opened_at: string | null;
  }[]) {
    if (!r.customer_id) continue;
    const stat = reminderStats.get(r.customer_id) ?? { sent: 0, opened: 0, lastAt: null };
    stat.sent += 1;
    if (r.opened_at) stat.opened += 1;
    if (!stat.lastAt || r.sent_at > stat.lastAt) stat.lastAt = r.sent_at;
    reminderStats.set(r.customer_id, stat);
  }

  // ── Score ────────────────────────────────────────────────────────────────
  type Scored = DeckRow & { searchKey: string; sortName: string; lastVisitAt: string | null };

  const scored: Scored[] = customers.map((c) => {
    const vehicles = vehiclesByCustomer.get(c.id) ?? [];
    const lastJob = lastJobByCustomer.get(c.id) ?? null;
    const lastPaid = lastPaidByCustomer.get(c.id) ?? null;
    const lastVisitAt = lastJob && lastPaid ? (lastJob > lastPaid ? lastJob : lastPaid) : (lastJob ?? lastPaid);
    const balance = Math.round((balanceByCustomer.get(c.id) ?? 0) * 100) / 100;
    const stats = reminderStats.get(c.id);

    const insight = computeInsight({
      fullName: c.full_name,
      vehicles: vehicles.map((v) => ({
        id: v.id,
        registration: v.registration,
        motExpiry: v.mot_expiry,
        serviceDue: v.service_due,
        taxDue: v.tax_due_date,
      })),
      balance,
      lifetimeValue: ltvByCustomer.get(c.id) ?? 0,
      visitCount: visitsByCustomer.get(c.id) ?? 0,
      lastVisitAt,
      createdAt: c.created_at,
      hasPlan: planCustomers.has(c.id),
      openQuote: openQuoteByCustomer.get(c.id) ?? null,
      remindersSent: stats?.sent ?? 0,
      remindersOpened: stats?.opened ?? 0,
      lastReminderAt: stats?.lastAt ?? null,
      now,
    });

    return {
      id: c.id,
      name: c.full_name,
      contact: c.email || c.phone || "no contact on file",
      isDemo: c.is_demo,
      branchName: c.preferred_location?.name ?? null,
      plates: vehicles.map((v) => v.registration),
      health: insight.health,
      segments: insight.segments,
      nextDue: formatNextDue(insight.nextDue),
      nextDueUrgency: dueUrgency(insight.nextDue?.days ?? null),
      lastIn: formatAgo(lastVisitAt, now),
      balance,
      lifetimeValue: ltvByCustomer.get(c.id) ?? 0,
      visitCount: visitsByCustomer.get(c.id) ?? 0,
      signal: insight.aiSignal,
      brief: insight.brief,
      actions: insight.actions,
      vehicles: vehicles.slice(0, 4).map((v) => {
        const soonest = [v.mot_expiry, v.service_due, v.tax_due_date]
          .map((d) => daysUntil(d, now))
          .filter((d): d is number => d !== null)
          .sort((a, b) => a - b)[0];
        return {
          registration: v.registration,
          model: [v.make, v.model].filter(Boolean).join(" ") || "—",
          due:
            soonest === undefined ? "—" : soonest < 0 ? `overdue ${-soonest}d` : `due ${soonest}d`,
          urgency: dueUrgency(soonest ?? null),
        };
      }),
      searchKey: norm([c.full_name ?? "", c.phone ?? "", ...vehicles.map((v) => v.registration)].join(" ")),
      sortName: (c.full_name ?? "").toLowerCase(),
      lastVisitAt,
    };
  });

  // Chip counts are live over everything in scope, before search/segment —
  // so a chip never reads 0 just because the current filter hides its rows.
  const segmentCounts: Record<SegmentKey, number> = {
    all: scored.length,
    attention: 0,
    mot30: 0,
    owes: 0,
    plan: 0,
    quiet: 0,
  };
  for (const row of scored) {
    for (const key of row.segments) segmentCounts[key] += 1;
  }

  const needle = norm(query);
  let rows = scored.filter(
    (r) => (segment === "all" || r.segments.includes(segment)) && (!needle || r.searchKey.includes(needle)),
  );

  rows =
    sort === "name"
      ? [...rows].sort((a, b) => a.sortName.localeCompare(b.sortName))
      : sort === "balance"
        ? [...rows].sort((a, b) => b.balance - a.balance || a.health - b.health)
        : sort === "recent"
          ? [...rows].sort((a, b) => (b.lastVisitAt ?? "").localeCompare(a.lastVisitAt ?? ""))
          : [...rows].sort((a, b) => a.health - b.health || a.sortName.localeCompare(b.sortName));

  const matchCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(matchCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const branchLabel =
    branch === "all"
      ? multiBranch
        ? "ALL BRANCHES"
        : (ctx.organization.name || "").toUpperCase()
      : (ctx.accessibleLocations.find((l) => l.id === branch)?.name ?? "").toUpperCase();

  const brandColor = ctx.branding.primaryColor ?? "#6366f1";

  return (
    <CustomersDeck
      rows={pageRows}
      segmentCounts={segmentCounts}
      segments={SEGMENTS}
      activeSegment={segment}
      sort={sort}
      branch={branch}
      branches={multiBranch ? ctx.accessibleLocations.map((l) => ({ id: l.id, name: l.name })) : []}
      query={query}
      page={safePage}
      pageSize={PAGE_SIZE}
      matchCount={matchCount}
      recordCount={scannedTotal}
      scanned={scored.length}
      scanTruncated={scanTruncated}
      branchLabel={branchLabel}
      brandColor={brandColor}
      onBrand={onBrandColor(brandColor)}
      error={error?.message ?? null}
    />
  );
}
