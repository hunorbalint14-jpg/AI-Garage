// CSAT maths for the post-service pulse (#508). Pure — shared by the
// dashboard tile and (later) the reports page. "CSAT" here is the share of
// responded pulses scoring 4–5; avg star score shown alongside.

export type PulseRow = { status: string; score: number | null };

export type CsatSummary = {
  /** Pulses that reached the customer (sent or responded). */
  delivered: number;
  responded: number;
  /** responded / delivered, 0–100 rounded; null when nothing delivered. */
  responseRatePct: number | null;
  /** Mean star score of responses, 1dp; null when no responses. */
  avgScore: number | null;
  /** % of responses scoring 4–5, rounded; null when no responses. */
  csatPct: number | null;
  lowScores: number;
};

export function csatSummary(rows: PulseRow[]): CsatSummary {
  const delivered = rows.filter((r) => r.status === "sent" || r.status === "responded").length;
  const responses = rows.filter((r) => r.status === "responded" && r.score !== null);
  const responded = responses.length;
  const avg =
    responded > 0 ? Math.round((responses.reduce((s, r) => s + (r.score ?? 0), 0) / responded) * 10) / 10 : null;
  const happy = responses.filter((r) => (r.score ?? 0) >= 4).length;
  return {
    delivered,
    responded,
    responseRatePct: delivered > 0 ? Math.round((responded / delivered) * 100) : null,
    avgScore: avg,
    csatPct: responded > 0 ? Math.round((happy / responded) * 100) : null,
    lowScores: responses.filter((r) => (r.score ?? 0) < 4).length,
  };
}
