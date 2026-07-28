import type { MtdReadiness } from "@/lib/mtd-readiness";

// MTD readiness (docs/mtd-readiness.md WS4) — server-rendered, derived
// checklist. Careful wording: AI Garage is a digital-link SOURCE feeding
// HMRC-recognised software; it is not itself HMRC-recognised and must
// never claim to be.

const DOT: Record<string, string> = {
  ok: "bg-ws-green",
  warn: "bg-ws-amber",
  todo: "bg-ws-red",
};

export function MtdReadinessCard({ readiness }: { readiness: MtdReadiness }) {
  return (
    <section className="rounded-lg border p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          Making Tax Digital readiness
          {readiness.ready ? (
            <span className="rounded-full bg-ws-green-bg text-ws-green px-2 py-0.5 text-xs font-medium">
              Ready
            </span>
          ) : (
            <span className="rounded-full bg-ws-amber-bg text-ws-amber px-2 py-0.5 text-xs font-medium">
              Action needed
            </span>
          )}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          MTD requires digital records flowing into HMRC-recognised software with no re-typing. AI
          Garage keeps your sales record digital and feeds it to your accounting package — the
          package (or your accountant) files the return.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {readiness.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.status]}`} aria-hidden />
            <div>
              <p className="text-sm font-medium">{c.label}</p>
              <p className="text-xs text-muted-foreground">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground border-t pt-3">
        AI Garage works with HMRC-recognised MTD software (Xero, QuickBooks, Sage) — it is not
        itself listed on HMRC&rsquo;s software directory and does not file returns.
      </p>
    </section>
  );
}
