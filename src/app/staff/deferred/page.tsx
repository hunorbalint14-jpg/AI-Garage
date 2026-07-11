import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/lib/permissions";
import { DeferredRowActions } from "./row-actions";

// Deferred-work pipeline (#498 PR 4): every outstanding repair the branch has
// banked — declined quote lines and never-quoted advisories — with lifecycle
// actions and the recovery numbers up top. Records are created by the
// decline/report hooks; the 14/30-day sequence (Automations → Deferred work
// follow-ups) does the chasing.

const STATUSES = ["open", "recovered", "dismissed"] as const;
type Status = (typeof STATUSES)[number];

type Row = {
  id: string;
  description: string;
  price: number | null;
  rag: "amber" | "red" | null;
  source: "quote_item" | "inspection_item";
  status: Status;
  followup_count: number;
  last_followup_at: string | null;
  dismissed_reason: string | null;
  recovered_at: string | null;
  recovered_booking_id: string | null;
  job_id: string | null;
  created_at: string;
  customer: { id: string; full_name: string | null } | null;
  vehicle: { id: string; registration: string | null } | null;
};

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function ageDays(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export default async function DeferredWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const canAct = hasPermission(ctx, "quotes_draft");

  const { status: statusParam } = await searchParams;
  const status: Status = (STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as Status)
    : "open";

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [{ data: rowsData }, { data: openSum }, { data: recoveredSum }] = await Promise.all([
    admin
      .from("deferred_work")
      .select(
        "id, description, price, rag, source, status, followup_count, last_followup_at, dismissed_reason, recovered_at, recovered_booking_id, job_id, created_at, customer:customers(id, full_name), vehicle:vehicles(id, registration)",
      )
      .eq("location_id", ctx.location.id)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("deferred_work").select("price").eq("location_id", ctx.location.id).eq("status", "open"),
    admin
      .from("deferred_work")
      .select("price")
      .eq("location_id", ctx.location.id)
      .eq("status", "recovered")
      .gte("recovered_at", monthStart.toISOString()),
  ]);

  const rows = (rowsData ?? []) as unknown as Row[];
  const sum = (list: { price: number | null }[] | null) =>
    (list ?? []).reduce((s, r) => s + (r.price ?? 0), 0);
  const openTotal = sum(openSum as { price: number | null }[] | null);
  const recoveredTotal = sum(recoveredSum as { price: number | null }[] | null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Deferred work</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Work customers declined or were advised of but never booked. The follow-up sequence chases it —
            configure it under <Link href="/staff/automations" className="underline underline-offset-2">Automations</Link>.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-lg border px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Open pipeline</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums">{fmtGBP(openTotal)}</div>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Recovered · this month</div>
          <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-ws-green">{fmtGBP(recoveredTotal)}</div>
        </div>
      </div>

      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "open" ? "/staff/deferred" : `/staff/deferred?status=${s}`}
            className={`rounded-md border px-3 py-1.5 text-sm capitalize ${
              s === status ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {status === "open"
            ? "Nothing outstanding — declined quote lines and unquoted advisories land here automatically."
            : `No ${status} records yet.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Work</th>
                <th className="px-4 py-2 font-medium text-right">Price</th>
                <th className="px-4 py-2 font-medium">Age</th>
                <th className="px-4 py-2 font-medium">Follow-ups</th>
                {canAct && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-4 py-2.5 font-mono">
                    {r.vehicle?.registration ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.customer ? (
                      <Link href={`/staff/customers/${r.customer.id}`} className="underline underline-offset-2">
                        {r.customer.full_name ?? "Customer"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {r.description}
                      {r.rag && (
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${
                            r.rag === "red"
                              ? "border-red-500/50 bg-red-500/25 text-ws-red"
                              : "border-amber-500/50 bg-amber-500/25 text-ws-amber"
                          }`}
                        >
                          {r.rag === "red" ? "Urgent" : "Advise"}
                        </span>
                      )}
                      <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">
                        {r.source === "quote_item" ? "Declined" : "Not quoted"}
                      </span>
                    </span>
                    {r.status === "dismissed" && r.dismissed_reason && (
                      <span className="mt-1 block text-xs text-muted-foreground">Dismissed: {r.dismissed_reason}</span>
                    )}
                    {r.status === "recovered" && (
                      <span className="mt-1 block text-xs text-ws-green">
                        Recovered{r.recovered_booking_id ? " via booking link" : " manually"}
                        {r.recovered_at &&
                          ` · ${new Date(r.recovered_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
                      </span>
                    )}
                    {r.job_id && (
                      <Link
                        href={r.source === "inspection_item" ? `/staff/jobs/${r.job_id}/inspection` : `/staff/jobs/${r.job_id}`}
                        className="mt-1 block text-xs text-muted-foreground underline underline-offset-2"
                      >
                        Source {r.source === "inspection_item" ? "check" : "job"} →
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.price !== null ? fmtGBP(r.price) : "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{ageDays(r.created_at)}d</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                    {r.followup_count > 0
                      ? `${r.followup_count} sent${r.last_followup_at ? ` · last ${new Date(r.last_followup_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`
                      : "none yet"}
                  </td>
                  {canAct && (
                    <td className="px-4 py-2.5 text-right">
                      <DeferredRowActions id={r.id} status={r.status} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Showing the latest {Math.min(rows.length, 200)} {status} record{rows.length === 1 ? "" : "s"} for {ctx.location.name}.
        Dismissing stops follow-ups for that item; reopening restarts its clock from today.
      </p>
    </div>
  );
}
