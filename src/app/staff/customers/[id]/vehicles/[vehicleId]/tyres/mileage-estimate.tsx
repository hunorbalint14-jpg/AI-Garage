import type { MileageEstimate } from "@/lib/tyre-care";

// Estimated current mileage (#596, PR 3). Shown with its workings on purpose:
// the number drives tyre-care recommendations, so staff need to see what it
// was derived from before they act on one.

const SOURCE_LABEL: Record<string, string> = {
  mot: "MOT test",
  job: "job visit",
  tyre_check: "tyre check",
  history: "imported history",
};

function formatDate(d: string): string {
  const parsed = new Date(d);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : d;
}

export function MileageEstimatePanel({ estimate }: { estimate: MileageEstimate | null }) {
  if (!estimate) {
    return (
      <div className="flex flex-col gap-1.5">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Estimated mileage
        </h3>
        <p className="text-xs text-muted-foreground">
          Not enough readings yet — two dated odometer readings are needed. Record the mileage on
          the next job or tyre check and an estimate appears here.
        </p>
      </div>
    );
  }

  const perYear = Math.round(estimate.avgDailyMiles * 365);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Estimated mileage
        </h3>
        <span
          className={`text-xs rounded-full px-2 py-0.5 ${
            estimate.confidence === "high"
              ? "bg-ws-green-bg text-ws-green"
              : "bg-ws-amber-bg text-ws-amber"
          }`}
        >
          {estimate.confidence === "high" ? "Good data" : "Rough estimate"}
        </span>
      </div>

      <p className="font-mono text-xl font-semibold">
        {estimate.estimatedNow.toLocaleString("en-GB")}{" "}
        <span className="text-sm font-normal text-muted-foreground">miles today</span>
      </p>

      <p className="text-xs text-muted-foreground">
        About {perYear.toLocaleString("en-GB")} miles/year, from{" "}
        {estimate.pointCount} readings. Last known:{" "}
        {estimate.anchor.miles.toLocaleString("en-GB")} miles at the{" "}
        {SOURCE_LABEL[estimate.anchor.source] ?? estimate.anchor.source} on{" "}
        {formatDate(estimate.anchor.on)}
        {estimate.daysSinceAnchor > 0 ? ` (${estimate.daysSinceAnchor} days ago)` : ""}.
      </p>
    </div>
  );
}
