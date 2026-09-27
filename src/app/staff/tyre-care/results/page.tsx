import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/lib/permissions";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { serviceTitle } from "@/lib/tyre-care-messages";
import { SMALL_SAMPLE, type Rate } from "@/lib/tyre-care-metrics";
import { loadTyreCareMetrics } from "@/lib/tyre-care-metrics-data";

// Tyre-care results (#596 PR 6): is it working, and is it trusted? Conversion
// says whether recommendations turn into work; the dismissal rate is the
// false-positive proxy; the unsubscribe rate is the trust canary; coverage
// says how much of the fleet the engine can see at all.

export const dynamic = "force-dynamic";

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function pct(r: Rate): string {
  return r.pct === null ? "—" : `${r.pct}%`;
}

/** "2 of 7 decisions", "0 of 1 customer". */
function fraction(r: Rate, noun: string): string {
  return `${r.numerator} of ${r.denominator} ${noun}${r.denominator === 1 ? "" : "s"}`;
}

function Tile({
  label,
  value,
  detail,
  tone,
  small,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "good" | "warn";
  small?: boolean;
}) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div
        className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
          tone === "good" ? "text-ws-green" : tone === "warn" ? "text-ws-amber" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {detail}
        {small && " · small sample"}
      </div>
    </div>
  );
}

function daysAgoLabel(iso: string): string {
  const d = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86_400_000));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

export default async function TyreCareResultsPage() {
  const ctx = await requireStaffContext();
  if (!(await isFeatureEnabled("tyre_care")) || !hasPermission(ctx, "reminders")) {
    return (
      <div className="flex flex-col gap-2 max-w-xl">
        <h1 className="text-2xl font-bold">Tyre care results</h1>
        <p className="text-sm text-muted-foreground">Not available for your account.</p>
      </div>
    );
  }

  const showMoney = hasPermission(ctx, "revenue");
  const m = await loadTyreCareMetrics(createAdminClient(), ctx.location.id);
  const smallSent = m.sent < SMALL_SAMPLE;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/staff/tyre-care" className="text-sm text-muted-foreground underline">
          ← Back to the review queue
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Tyre care results</h1>
        <p className="text-sm text-muted-foreground mt-1">Last {m.windowDays} days at this branch.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Sent" value={String(m.sent)} detail={`${m.raised} raised in the period`} />
        <Tile
          label="Booked"
          value={pct(m.conversion)}
          detail={`${fraction(m.conversion, "message")}${m.medianDaysToBook !== null ? ` · median ${m.medianDaysToBook} days` : ""}`}
          tone={m.booked > 0 ? "good" : undefined}
          small={smallSent && m.sent > 0}
        />
        {showMoney && (
          <Tile
            label="Paid revenue"
            value={fmtGBP(m.paidRevenue)}
            detail={
              m.bookedValueUninvoiced > 0 ? `+ ${fmtGBP(m.bookedValueUninvoiced)} booked, not yet invoiced` : "from tyre-care bookings"
            }
            tone={m.paidRevenue > 0 ? "good" : undefined}
          />
        )}
        <Tile
          label="Dismissed by staff"
          value={pct(m.dismissal)}
          detail={`${fraction(m.dismissal, "decision")}`}
          tone={m.dismissal.pct !== null && m.dismissal.pct >= 50 ? "warn" : undefined}
          small={m.dismissal.denominator > 0 && m.dismissal.denominator < SMALL_SAMPLE}
        />
        <Tile
          label="Unsubscribed"
          value={pct(m.unsubscribes)}
          detail={`${fraction(m.unsubscribes, "customer")} messaged`}
          tone={m.unsubscribes.pct !== null && m.unsubscribes.pct >= 5 ? "warn" : undefined}
          small={m.unsubscribes.denominator > 0 && m.unsubscribes.denominator < SMALL_SAMPLE}
        />
        <Tile
          label="Coverage"
          value={m.coverage?.estimatePct != null ? `${m.coverage.estimatePct}%` : "—"}
          detail={m.coverage ? `of ${m.coverage.vehicles} vehicles have a mileage estimate` : "no nightly run yet"}
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Conversion by recommendation
        </h2>
        {m.segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing sent in this period yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border max-w-2xl">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Recommendation</th>
                  <th className="px-4 py-2 font-medium">Evidence</th>
                  <th className="px-4 py-2 font-medium text-right">Sent</th>
                  <th className="px-4 py-2 font-medium text-right">Booked</th>
                  <th className="px-4 py-2 font-medium text-right">Rate</th>
                </tr>
              </thead>
              <tbody>
                {m.segments.map((s) => (
                  <tr key={`${s.serviceType}-${s.confidence}`} className="border-t">
                    <td className="px-4 py-2">{serviceTitle(s.serviceType)}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {s.confidence === "high" ? "Measured" : "Mileage estimate"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{s.sent}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{s.booked}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{pct(s.conversion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground max-w-2xl">
          Measured evidence is tread readings, MOT advisories or recent work; a mileage estimate alone is weaker. If
          estimate-only recommendations rarely book, raise the rotation interval under Automations.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Why staff dismissed recommendations
        </h2>
        {m.dismissalReasons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dismissals in this period.</p>
        ) : (
          <ul className="flex flex-col gap-1 max-w-md text-sm">
            {m.dismissalReasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-4 border-b py-1.5 last:border-b-0">
                <span>{r.reason}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 max-w-2xl">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">Coverage</h2>
        {m.coverage ? (
          <p className="text-sm">
            Of <strong>{m.coverage.vehicles}</strong> vehicles whose owners use this branch,{" "}
            <strong>{m.coverage.withHistory}</strong> have been serviced here ({m.coverage.historyPct ?? 0}%) and{" "}
            <strong>{m.coverage.withEstimate}</strong> have enough dated mileage readings for an estimate (
            {m.coverage.estimatePct ?? 0}%). Last nightly check: {daysAgoLabel(m.coverage.ranAt)}
            {m.coverage.truncated ? " — it ran out of time, so these figures cover only part of the fleet" : ""}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The nightly check hasn&apos;t run for this branch yet. Enable it under Automations.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Recording the mileage on every job is the single biggest lever on coverage.
        </p>
      </section>
    </div>
  );
}
