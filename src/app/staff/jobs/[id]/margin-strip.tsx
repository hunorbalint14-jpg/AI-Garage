import Link from "next/link";
import { TrendingUp } from "lucide-react";
import type { JobMargin } from "@/lib/margin";

// Per-job P&L strip (#502). Rendered only for roles with the revenue
// permission — mechanics don't see margins. Unknowns say so; nothing is
// guessed.

function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "red" | "amber" }) {
  const toneCls = tone === "green" ? "text-ws-green" : tone === "red" ? "text-ws-red" : tone === "amber" ? "text-ws-amber" : "";
  return (
    <div className="min-w-[130px]">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function MarginStrip({ margin, rateConfigured }: { margin: JobMargin; rateConfigured: boolean }) {
  if (margin.totalSell === 0) return null;

  const hours = margin.clockedMinutes / 60;
  return (
    <section className="rounded-lg border p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ws-text-3">
          Job profitability · ex VAT
        </h2>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Cell
          label="Gross profit"
          value={margin.grossProfit !== null ? `${fmtGBP(margin.grossProfit)}` : "—"}
          sub={
            margin.grossMarginPct !== null
              ? `${margin.grossMarginPct}% of ${fmtGBP(margin.totalSell)}`
              : `of ${fmtGBP(margin.totalSell)} sold`
          }
          tone={margin.grossProfit === null ? undefined : margin.grossProfit >= 0 ? "green" : "red"}
        />
        <Cell
          label="Parts"
          value={margin.partsMarginPct !== null ? `${margin.partsMarginPct}%` : margin.partsSell > 0 ? "—" : "n/a"}
          sub={
            margin.partsSell > 0
              ? margin.unknownPartCostCount > 0
                ? `${fmtGBP(margin.partsSell)} sold · ${margin.unknownPartCostCount} line${margin.unknownPartCostCount === 1 ? "" : "s"} missing cost`
                : `${fmtGBP(margin.partsSell)} sold · ${fmtGBP(margin.partsCost)} cost`
              : "no parts"
          }
          tone={margin.unknownPartCostCount > 0 ? "amber" : undefined}
        />
        <Cell
          label="Labour"
          value={margin.labourSold > 0 ? fmtGBP(margin.labourSold) : "n/a"}
          sub={
            margin.clockedMinutes > 0
              ? `${hours.toFixed(1)}h clocked${margin.labourCost !== null ? ` · ${fmtGBP(margin.labourCost)} cost` : ""}`
              : "nothing clocked yet"
          }
        />
        <Cell
          label="Effective labour rate"
          value={margin.effectiveLabourRate !== null ? `${fmtGBP(margin.effectiveLabourRate)}/h` : "—"}
          sub={margin.effectiveLabourRate === null ? "needs clocked time" : "invoiced ÷ clocked"}
        />
      </div>
      {!rateConfigured && (
        <p className="text-xs text-muted-foreground">
          Set your labour cost rate in{" "}
          <Link href="/staff/settings?tab=payments" className="underline underline-offset-2">
            Settings → Payments
          </Link>{" "}
          to include labour cost in gross profit.
        </p>
      )}
    </section>
  );
}
