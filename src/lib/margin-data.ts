import { createAdminClient } from "@/lib/supabase/admin";
import { aggregateMargins, type MarginLine, type PeriodJob, type PeriodMargin } from "@/lib/margin";

// Server half of the period-margin maths (#502 PR 2): one fetch used by the
// reports page, the dashboard tiles, and the digest note. Period membership
// = jobs whose invoice was PAID in the window (reconciles with the money
// reports); a job's clocked time counts in full, whenever it was worked.

type Admin = ReturnType<typeof createAdminClient>;

export async function fetchPeriodMargin(
  admin: Admin,
  args: {
    /** invoices scope — org-wide or a single branch (the reports pattern). */
    scopeColumn: "organization_id" | "location_id";
    scopeValue: string;
    fromIso: string;
    toIso: string;
    labourCostRate: number | null;
  },
): Promise<PeriodMargin> {
  const { data: paid } = await admin
    .from("invoices")
    .select("job_id")
    .eq(args.scopeColumn, args.scopeValue)
    .eq("status", "paid")
    .gte("paid_at", args.fromIso)
    .lt("paid_at", args.toIso)
    .not("job_id", "is", null);
  const jobIds = [...new Set(((paid ?? []) as { job_id: string }[]).map((r) => r.job_id))];
  if (jobIds.length === 0) return aggregateMargins([], args.labourCostRate);

  const [{ data: lineRows }, { data: timeRows }] = await Promise.all([
    admin
      .from("job_items")
      .select("job_id, type, quantity, unit_price, unit_cost, service:services(category)")
      .in("job_id", jobIds),
    admin
      .from("job_time_entries")
      .select("job_id, duration_minutes")
      .in("job_id", jobIds)
      .not("duration_minutes", "is", null),
  ]);

  type LineRow = MarginLine & { job_id: string; service: { category: string | null } | null };
  const linesByJob = new Map<string, LineRow[]>();
  for (const l of ((lineRows ?? []) as unknown as LineRow[])) {
    linesByJob.set(l.job_id, [...(linesByJob.get(l.job_id) ?? []), l]);
  }
  const minutesByJob = new Map<string, number>();
  for (const t of ((timeRows ?? []) as { job_id: string; duration_minutes: number }[])) {
    minutesByJob.set(t.job_id, (minutesByJob.get(t.job_id) ?? 0) + t.duration_minutes);
  }

  const jobs: PeriodJob[] = jobIds.map((id) => {
    const lines = linesByJob.get(id) ?? [];
    // Dominant category: the largest labour line's service category.
    const labour = lines
      .filter((l) => l.type === "labour")
      .sort((a, b) => b.quantity * b.unit_price - a.quantity * a.unit_price);
    const category = labour.find((l) => l.service?.category)?.service?.category ?? "General";
    return { lines, clockedMinutes: minutesByJob.get(id) ?? 0, category };
  });

  return aggregateMargins(jobs, args.labourCostRate);
}

export async function orgLabourCostRate(admin: Admin, organizationId: string): Promise<number | null> {
  const { data } = await admin
    .from("organizations")
    .select("labour_cost_rate")
    .eq("id", organizationId)
    .maybeSingle();
  const rate = (data as { labour_cost_rate: number | null } | null)?.labour_cost_rate;
  return rate !== null && rate !== undefined ? Number(rate) : null;
}
