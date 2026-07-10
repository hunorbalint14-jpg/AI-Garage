import { describe, expect, it } from "vitest";
import { csatSummary } from "./csat";

describe("csatSummary", () => {
  it("empty input → nulls, zero counts", () => {
    expect(csatSummary([])).toEqual({
      delivered: 0,
      responded: 0,
      responseRatePct: null,
      avgScore: null,
      csatPct: null,
      lowScores: 0,
    });
  });

  it("computes rates from delivered pulses only", () => {
    const out = csatSummary([
      { status: "responded", score: 5 },
      { status: "responded", score: 4 },
      { status: "responded", score: 2 },
      { status: "sent", score: null },
      { status: "queued", score: null }, // not delivered yet
      { status: "suppressed", score: null }, // capped — never delivered
      { status: "failed", score: null },
    ]);
    expect(out.delivered).toBe(4);
    expect(out.responded).toBe(3);
    expect(out.responseRatePct).toBe(75);
    expect(out.avgScore).toBe(3.7);
    expect(out.csatPct).toBe(67);
    expect(out.lowScores).toBe(1);
  });

  it("all happy → 100% CSAT", () => {
    const out = csatSummary([
      { status: "responded", score: 5 },
      { status: "responded", score: 4 },
    ]);
    expect(out.csatPct).toBe(100);
    expect(out.lowScores).toBe(0);
  });
});
