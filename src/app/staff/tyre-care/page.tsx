import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/lib/permissions";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { Evidence } from "@/lib/tyre-care";
import { TyreCareRowActions } from "./row-actions";

// Tyre-care review queue (#596 PR 4). Recommendations the nightly check has
// raised for customers whose home branch is this one, each with the evidence
// it rests on. Staff judge the evidence here; dismissals and their reasons are
// the false-positive signal the thresholds are tuned against.

export const dynamic = "force-dynamic";

const TABS = [
  { status: "pending_review", label: "To review" },
  { status: "dismissed", label: "Dismissed" },
  { status: "expired", label: "No longer due" },
] as const;
type TabStatus = (typeof TABS)[number]["status"];

/** An MOT this close is the better moment to raise tyre care (spec: bundle with MOT). */
const MOT_BUNDLE_DAYS = 45;

type Row = {
  id: string;
  service_type: "rotation" | "alignment" | "balance";
  confidence: "high" | "low";
  evidence: Evidence;
  status: TabStatus;
  dismissed_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  customer: { id: string; full_name: string | null; anonymized_at: string | null } | null;
  vehicle: {
    id: string;
    registration: string | null;
    make: string | null;
    model: string | null;
    mot_expiry: string | null;
  } | null;
};

const SERVICE_LABEL: Record<Row["service_type"], string> = {
  rotation: "Tyre rotation",
  alignment: "Wheel alignment",
  balance: "Wheel balancing",
};

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 86_400_000) : null;
}

function ageLabel(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

export default async function TyreCarePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireStaffContext();

  if (!(await isFeatureEnabled("tyre_care"))) {
    return (
      <div className="flex flex-col gap-2 max-w-xl">
        <h1 className="text-2xl font-bold">Tyre care</h1>
        <p className="text-sm text-muted-foreground">
          Tyre-care recommendations aren&apos;t switched on for your account yet.
        </p>
      </div>
    );
  }

  if (!hasPermission(ctx, "reminders")) {
    return (
      <div className="flex flex-col gap-2 max-w-xl">
        <h1 className="text-2xl font-bold">Tyre care</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to customer reminders.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const { status: statusParam } = await searchParams;
  const status: TabStatus = TABS.some((t) => t.status === statusParam)
    ? (statusParam as TabStatus)
    : "pending_review";

  const [{ data: rowsData }, { count: pendingCount }] = await Promise.all([
    admin
      .from("tyre_recommendations")
      .select(
        "id, service_type, confidence, evidence, status, dismissed_reason, reviewed_at, created_at, updated_at, customer:customers(id, full_name, anonymized_at), vehicle:vehicles(id, registration, make, model, mot_expiry)",
      )
      .eq("location_id", ctx.location.id)
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("tyre_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .eq("status", "pending_review"),
  ]);

  // Anonymised customers are never contacted; don't show them work to do.
  const rows = ((rowsData ?? []) as unknown as Row[])
    .filter((r) => r.customer && !r.customer.anonymized_at)
    // Strongest evidence first when reviewing.
    .sort((a, b) =>
      status === "pending_review" && a.confidence !== b.confidence ? (a.confidence === "high" ? -1 : 1) : 0,
    );

  // Wheel setup is read live: staff often confirm it after the item is raised.
  const rotationVehicleIds = [
    ...new Set(rows.filter((r) => r.service_type === "rotation" && r.vehicle).map((r) => r.vehicle!.id)),
  ];
  const { data: profiles } = rotationVehicleIds.length
    ? await admin.from("vehicle_wheel_profile").select("vehicle_id, tyre_config").in("vehicle_id", rotationVehicleIds)
    : { data: [] };
  const confirmedSetup = new Set(
    ((profiles ?? []) as { vehicle_id: string; tyre_config: string }[])
      .filter((p) => p.tyre_config === "standard")
      .map((p) => p.vehicle_id),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          Tyre care
          <span className="ml-2 rounded border border-[#5a4218] bg-[#3a2c14] px-1 py-px align-middle font-mono text-[8px] tracking-[.1em] text-[#ffb020]">
            BETA
          </span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Rotation and alignment recommendations raised overnight for customers of this branch, each with the evidence
          behind it. Dismiss anything that doesn&apos;t look right — your reasons tune the thresholds. The nightly check
          and its intervals live under{" "}
          <Link href="/staff/automations" className="underline underline-offset-2">
            Automations
          </Link>
          .
        </p>
      </div>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={t.status === "pending_review" ? "/staff/tyre-care" : `/staff/tyre-care?status=${t.status}`}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              t.status === status ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {t.label}
            {t.status === "pending_review" && (pendingCount ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 font-mono text-xs">{pendingCount}</span>
            )}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {status === "pending_review"
            ? "Nothing to review. The nightly check adds vehicles here when a rotation or alignment is genuinely due."
            : status === "dismissed"
              ? "No dismissed recommendations."
              : "Nothing has lapsed — items move here when the evidence behind them no longer holds."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Recommendation</th>
                <th className="px-4 py-2 font-medium">Why</th>
                <th className="px-4 py-2 font-medium">Raised</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const motIn = daysUntil(r.vehicle?.mot_expiry ?? null);
                const motSoon = motIn !== null && motIn >= 0 && motIn <= MOT_BUNDLE_DAYS;
                const needsSetup =
                  r.service_type === "rotation" && r.vehicle !== null && !confirmedSetup.has(r.vehicle.id);
                const vehicleHref =
                  r.customer && r.vehicle ? `/staff/customers/${r.customer.id}/vehicles/${r.vehicle.id}/edit` : null;
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="px-4 py-3">
                      {vehicleHref ? (
                        <Link href={vehicleHref} className="font-mono font-semibold underline-offset-2 hover:underline">
                          {r.vehicle?.registration ?? "—"}
                        </Link>
                      ) : (
                        <span className="font-mono">{r.vehicle?.registration ?? "—"}</span>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {[r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(" ") || " "}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {r.customer ? (
                        <Link href={`/staff/customers/${r.customer.id}`} className="underline-offset-2 hover:underline">
                          {r.customer.full_name ?? "Customer"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{SERVICE_LABEL[r.service_type]}</div>
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${
                          r.confidence === "high" ? "bg-ws-green-bg text-ws-green" : "bg-ws-amber-bg text-ws-amber"
                        }`}
                      >
                        {r.confidence === "high" ? "Measured evidence" : "Mileage estimate"}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-md">
                      <p className="text-sm">{r.evidence.reason}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {needsSetup && vehicleHref && (
                          <Link
                            href={vehicleHref}
                            className="rounded border border-ws-amber-border bg-ws-amber-bg px-1.5 py-0.5 text-xs text-ws-amber hover:underline"
                          >
                            Wheel setup not confirmed
                          </Link>
                        )}
                        {motSoon && (
                          <span className="rounded border border-ws-blue-border bg-ws-blue-bg px-1.5 py-0.5 text-xs text-ws-blue">
                            MOT due in {motIn} day{motIn === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      {r.status === "dismissed" && r.dismissed_reason && (
                        <p className="mt-1 text-xs text-muted-foreground">Dismissed: {r.dismissed_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{ageLabel(r.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <TyreCareRowActions id={r.id} status={r.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
