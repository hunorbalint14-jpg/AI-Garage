import { describe, it, expect } from "vitest";
import {
  estimateMileage,
  powertrainMultiplier,
  analyseTread,
  matchesAlignmentAdvisory,
  isSteeringWork,
  evaluateTyreCare,
  type OdometerPoint,
  type TyreCareInput,
} from "./tyre-care";

// Midnight so date-only readings (the DB stores dates, not timestamps) give
// exact day arithmetic in the expectations below.
const NOW = new Date("2026-09-27T00:00:00Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

describe("estimateMileage", () => {
  it("needs two points — one reading can't give a rate", () => {
    expect(estimateMileage([{ on: daysAgo(10), miles: 40_000, source: "job" }], NOW)).toBeNull();
    expect(estimateMileage([], NOW)).toBeNull();
  });

  it("projects forward from the most recent reading", () => {
    // 3,650 miles over 365 days = 10/day; 30 days on from the anchor.
    const points: OdometerPoint[] = [
      { on: daysAgo(395), miles: 30_000, source: "mot" },
      { on: daysAgo(30), miles: 33_650, source: "job" },
    ];
    const est = estimateMileage(points, NOW)!;
    expect(est.avgDailyMiles).toBeCloseTo(10, 1);
    expect(est.estimatedNow).toBe(33_950);
    expect(est.anchor.miles).toBe(33_650);
    expect(est.anchor.source).toBe("job");
    expect(est.daysSinceAnchor).toBe(30);
  });

  it("weights recent usage over old usage", () => {
    // Long quiet period, then heavy recent use. A flat average would land near
    // 10/day; the recency weighting must pull it well above that.
    const points: OdometerPoint[] = [
      { on: daysAgo(1000), miles: 10_000, source: "mot" },
      { on: daysAgo(600), miles: 12_000, source: "mot" }, // 5/day
      { on: daysAgo(300), miles: 14_000, source: "mot" }, // ~6.7/day
      { on: daysAgo(100), miles: 22_000, source: "job" }, // 40/day
    ];
    const est = estimateMileage(points, NOW)!;
    expect(est.avgDailyMiles).toBeGreaterThan(20);
  });

  it("drops a decreasing odometer reading and keeps the history around it", () => {
    // The middle reading is clocked or mistyped. Discarding just that reading
    // leaves 50,000 -> 54,000 over 300 days; without it the recovery hop would
    // look like an impossible spike and we'd lose the vehicle entirely.
    const points: OdometerPoint[] = [
      { on: daysAgo(400), miles: 50_000, source: "mot" },
      { on: daysAgo(200), miles: 9_000, source: "job" },
      { on: daysAgo(100), miles: 54_000, source: "job" },
    ];
    const est = estimateMileage(points, NOW)!;
    expect(est.pointCount).toBe(2);
    expect(est.avgDailyMiles).toBeCloseTo(4_000 / 300, 2);
    expect(est.estimatedNow).toBeGreaterThan(54_000);
  });

  it("trusts newer readings when migrated history contradicts DVSA", () => {
    // Regression: a stale, wrong-high imported figure used to become the
    // anchor, discard every fresher reading, and inflate the estimate by
    // ~35,000 miles. Found by rendering the vehicle page against real-shaped
    // demo data.
    const points: OdometerPoint[] = [
      { on: "2023-08-14", miles: 22_400, source: "mot" },
      { on: "2024-08-19", miles: 29_850, source: "mot" },
      { on: "2024-11-12", miles: 47_810, source: "history" }, // contradicts the MOTs
      { on: "2025-08-21", miles: 37_120, source: "mot" },
      { on: "2026-07-16", miles: 44_950, source: "tyre_check" },
      { on: "2026-07-25", miles: 45_210, source: "job" },
    ];
    const est = estimateMileage(points, NOW)!;
    expect(est.anchor.source).toBe("job");
    expect(est.anchor.miles).toBe(45_210);
    expect(est.pointCount).toBe(5); // the imported outlier alone is dropped
    expect(est.estimatedNow).toBeGreaterThan(45_210);
    expect(est.estimatedNow).toBeLessThan(50_000); // not the 80k the bug produced
    expect(est.confidence).toBe("high");
  });

  it("discards an implausible rate rather than projecting it", () => {
    const points: OdometerPoint[] = [
      { on: daysAgo(2), miles: 10_000, source: "job" },
      { on: daysAgo(1), miles: 500_000, source: "job" }, // 490k miles in a day
    ];
    expect(estimateMileage(points, NOW)).toBeNull();
  });

  it("collapses same-day readings, keeping the higher", () => {
    const points: OdometerPoint[] = [
      { on: daysAgo(100), miles: 20_000, source: "mot" },
      { on: daysAgo(10), miles: 22_000, source: "mot" },
      { on: daysAgo(10), miles: 22_100, source: "job" },
    ];
    const est = estimateMileage(points, NOW)!;
    expect(est.pointCount).toBe(2);
    expect(est.anchor.miles).toBe(22_100);
  });

  it("drops future-dated readings", () => {
    const future = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const points: OdometerPoint[] = [
      { on: daysAgo(100), miles: 20_000, source: "job" },
      { on: future, miles: 99_000, source: "job" },
    ];
    expect(estimateMileage(points, NOW)).toBeNull();
  });

  it("marks a thin or stale series low confidence", () => {
    const thin = estimateMileage(
      [
        { on: daysAgo(400), miles: 20_000, source: "mot" },
        { on: daysAgo(30), miles: 24_000, source: "mot" },
      ],
      NOW,
    )!;
    expect(thin.confidence).toBe("low"); // only two points

    const stale = estimateMileage(
      [
        { on: daysAgo(1400), miles: 10_000, source: "mot" },
        { on: daysAgo(1000), miles: 14_000, source: "mot" },
        { on: daysAgo(700), miles: 18_000, source: "mot" }, // anchor > 18 months old
      ],
      NOW,
    )!;
    expect(stale.confidence).toBe("low");

    const good = estimateMileage(
      [
        { on: daysAgo(800), miles: 10_000, source: "mot" },
        { on: daysAgo(400), miles: 14_000, source: "mot" },
        { on: daysAgo(40), miles: 18_000, source: "job" },
      ],
      NOW,
    )!;
    expect(good.confidence).toBe("high");
  });
});

describe("powertrainMultiplier", () => {
  it("shortens intervals for EVs and hybrids, hybrid taking precedence", () => {
    expect(powertrainMultiplier("ELECTRICITY")).toBe(0.8);
    // "HYBRID ELECTRIC" matches /electric/ too — hybrid must win.
    expect(powertrainMultiplier("HYBRID ELECTRIC")).toBe(0.9);
    expect(powertrainMultiplier("PETROL")).toBe(1);
    expect(powertrainMultiplier(null)).toBe(1);
  });
});

describe("analyseTread", () => {
  it("reads the newest check and measures both differentials", () => {
    const analysis = analyseTread([
      {
        checked_at: "2025-01-01",
        nsf_depth: 8,
        osf_depth: 8,
        nsr_depth: 8,
        osr_depth: 8,
      },
      {
        checked_at: "2026-09-01",
        nsf_depth: 3.0,
        osf_depth: 5.0, // 2.0mm same-axle gap
        nsr_depth: 6.0,
        osr_depth: 6.0,
      },
    ])!;
    expect(analysis.checkedAt).toBe("2026-09-01");
    expect(analysis.axleDifferential).toBe(2);
    expect(analysis.crossAxleDiff).toBe(2); // front avg 4.0 vs rear 6.0
    expect(analysis.anyReplaced).toBe(false);
  });

  it("reports null, not zero, when a differential cannot be computed", () => {
    // Only one corner recorded. Zero would read as "perfectly even wear" and
    // quietly suppress an alignment trigger that was never actually evaluated.
    const analysis = analyseTread([
      { checked_at: "2026-09-01", nsf_depth: 4, osf_depth: null, nsr_depth: null, osr_depth: null },
    ])!;
    expect(analysis.axleDifferential).toBeNull();
    expect(analysis.crossAxleDiff).toBeNull();
  });

  it("returns null with no checks", () => {
    expect(analyseTread([])).toBeNull();
  });
});

describe("advisory and work matching", () => {
  it("spots uneven-wear advisory wording", () => {
    expect(matchesAlignmentAdvisory("Nearside front tyre worn on inner edge")).toBe(true);
    expect(matchesAlignmentAdvisory("Offside front tyre unevenly worn")).toBe(true);
    expect(matchesAlignmentAdvisory("Tyre worn close to the legal limit")).toBe(false);
    expect(matchesAlignmentAdvisory(null)).toBe(false);
  });

  it("spots steering and suspension work", () => {
    expect(isSteeringWork("Replaced offside track rod end")).toBe(true);
    expect(isSteeringWork("Front suspension spring replacement")).toBe(true);
    expect(isSteeringWork("Oil and filter change")).toBe(false);
  });
});

function baseInput(overrides: Partial<TyreCareInput> = {}): TyreCareInput {
  return {
    now: NOW,
    fuelType: "PETROL",
    tyreConfig: "standard",
    odometerPoints: [
      { on: daysAgo(400), miles: 30_000, source: "mot" },
      { on: daysAgo(40), miles: 40_000, source: "job" },
    ],
    tyreChecks: [],
    motAdvisories: [],
    serviceEvents: [],
    visits: [],
    ...overrides,
  };
}

describe("evaluateTyreCare — rotation", () => {
  it("fires once the interval is passed, low confidence on mileage alone", () => {
    const result = evaluateTyreCare(
      baseInput({
        serviceEvents: [
          { service_type: "rotation", performed_at: daysAgo(400), odometer_miles: 30_000 },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "rotation")!;
    expect(rec.confidence).toBe("low");
    expect(rec.customerContactable).toBe(true);
    expect(rec.evidence.rule_key).toBe("rotation.interval");
    expect(rec.evidence.inputs.miles_since_rotation).toBeGreaterThanOrEqual(6_000);
    expect(rec.evidence.reason).toMatch(/miles since your tyres were rotated/);
  });

  it("upgrades to high confidence when tread corroborates", () => {
    const result = evaluateTyreCare(
      baseInput({
        serviceEvents: [
          { service_type: "rotation", performed_at: daysAgo(400), odometer_miles: 30_000 },
        ],
        tyreChecks: [
          {
            checked_at: daysAgo(20),
            nsf_depth: 4,
            osf_depth: 4,
            nsr_depth: 6,
            osr_depth: 6, // 2.0mm cross-axle
          },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "rotation")!;
    expect(rec.confidence).toBe("high");
    expect(rec.evidence.reason).toMatch(/faster than the rears/);
  });

  it("never recommends rotation on staggered or directional fitment", () => {
    for (const config of ["staggered", "directional"] as const) {
      const result = evaluateTyreCare(
        baseInput({
          tyreConfig: config,
          serviceEvents: [
            { service_type: "rotation", performed_at: daysAgo(400), odometer_miles: 30_000 },
          ],
        }),
      );
      expect(result.recommendations.find((r) => r.serviceType === "rotation")).toBeUndefined();
      expect(result.suppressions.some((s) => s.serviceType === "rotation")).toBe(true);
    }
  });

  it("still queues an unconfirmed profile, but flags it for staff", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreConfig: "unknown",
        serviceEvents: [
          { service_type: "rotation", performed_at: daysAgo(400), odometer_miles: 30_000 },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "rotation")!;
    expect(rec.requiresWheelProfile).toBe(true);
  });

  it("shortens the interval for an EV", () => {
    // 5,000 miles covered: under the 6,000 petrol interval, over the 4,800 EV one.
    const points: OdometerPoint[] = [
      { on: daysAgo(400), miles: 30_000, source: "mot" },
      { on: daysAgo(1), miles: 35_000, source: "job" },
    ];
    const events = [
      { service_type: "rotation" as const, performed_at: daysAgo(400), odometer_miles: 30_000 },
    ];
    const petrol = evaluateTyreCare(
      baseInput({ fuelType: "PETROL", odometerPoints: points, serviceEvents: events }),
    );
    const ev = evaluateTyreCare(
      baseInput({ fuelType: "ELECTRICITY", odometerPoints: points, serviceEvents: events }),
    );
    expect(petrol.recommendations.find((r) => r.serviceType === "rotation")).toBeUndefined();
    expect(ev.recommendations.find((r) => r.serviceType === "rotation")).toBeDefined();
  });

  it("suppresses inside the cooldown even when the mileage qualifies", () => {
    const result = evaluateTyreCare(
      baseInput({
        serviceEvents: [
          // 30 days ago but 10,000 miles back: the date clock has not elapsed.
          { service_type: "rotation", performed_at: daysAgo(30), odometer_miles: 30_000 },
        ],
      }),
    );
    expect(result.recommendations.find((r) => r.serviceType === "rotation")).toBeUndefined();
    expect(
      result.suppressions.find((s) => s.serviceType === "rotation")?.reason,
    ).toMatch(/cooldown/);
  });

  it("suppresses on the mileage clock too, not just the date", () => {
    const result = evaluateTyreCare(
      baseInput({
        serviceEvents: [
          // 200 days ago (date clock elapsed) but only ~1,000 miles back.
          { service_type: "rotation", performed_at: daysAgo(200), odometer_miles: 39_000 },
        ],
      }),
    );
    expect(result.recommendations.find((r) => r.serviceType === "rotation")).toBeUndefined();
  });

  it("says so when there is not enough mileage data", () => {
    const result = evaluateTyreCare(
      baseInput({
        odometerPoints: [{ on: daysAgo(10), miles: 40_000, source: "job" }],
        serviceEvents: [
          { service_type: "rotation", performed_at: daysAgo(400), odometer_miles: 30_000 },
        ],
      }),
    );
    expect(result.mileage).toBeNull();
    expect(
      result.suppressions.find((s) => s.serviceType === "rotation")?.reason,
    ).toMatch(/odometer readings/);
  });
});

describe("evaluateTyreCare — alignment", () => {
  it("fires on a same-axle differential", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreChecks: [
          { checked_at: daysAgo(10), nsf_depth: 3, osf_depth: 5, nsr_depth: 6, osr_depth: 6 },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "alignment")!;
    expect(rec.evidence.rule_key).toBe("alignment.axle_differential");
    expect(rec.confidence).toBe("high");
  });

  it("fires on MOT advisory wording", () => {
    const result = evaluateTyreCare(
      baseInput({
        motAdvisories: [
          {
            test_date: daysAgo(60),
            text: "Nearside front tyre worn on inner edge",
            type: "ADVISORY",
          },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "alignment")!;
    expect(rec.evidence.rule_key).toBe("alignment.mot_advisory");
  });

  it("ignores an advisory the car has already been aligned for", () => {
    // Regression: advisories weren't checked against the last alignment, so
    // an old "worn on inner edge" kept recommending work already done.
    const result = evaluateTyreCare(
      baseInput({
        motAdvisories: [
          { test_date: daysAgo(400), text: "Nearside front tyre worn on inner edge", type: "ADVISORY" },
        ],
        serviceEvents: [
          // Aligned after that MOT, and well outside the cooldown.
          { service_type: "alignment", performed_at: daysAgo(300), odometer_miles: 33_000 },
        ],
      }),
    );
    expect(result.recommendations.find((r) => r.serviceType === "alignment")).toBeUndefined();
  });

  it("ignores an advisory too old to describe the car today", () => {
    const result = evaluateTyreCare(
      baseInput({
        motAdvisories: [
          { test_date: daysAgo(900), text: "Offside front tyre unevenly worn", type: "ADVISORY" },
        ],
      }),
    );
    expect(result.recommendations.find((r) => r.serviceType === "alignment")).toBeUndefined();
  });

  it("fires after steering work with no alignment since", () => {
    const result = evaluateTyreCare(
      baseInput({ visits: [{ on: daysAgo(20), description: "Replaced offside track rod end" }] }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "alignment")!;
    expect(rec.evidence.rule_key).toBe("alignment.after_steering_work");
  });

  it("does not fire when the alignment followed the steering work", () => {
    const result = evaluateTyreCare(
      baseInput({
        visits: [{ on: daysAgo(200), description: "Front suspension strut replacement" }],
        serviceEvents: [
          { service_type: "alignment", performed_at: daysAgo(150), odometer_miles: 35_000 },
        ],
      }),
    );
    expect(result.recommendations.find((r) => r.serviceType === "alignment")).toBeUndefined();
  });

  it("fires on new tyres fitted without an alignment", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreChecks: [
          {
            checked_at: daysAgo(15),
            nsf_depth: 8,
            osf_depth: 8,
            nsr_depth: 8,
            osr_depth: 8,
            nsf_replaced: true,
            osf_replaced: true,
          },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "alignment")!;
    expect(rec.evidence.rule_key).toBe("alignment.new_tyres_unaligned");
  });

  it("raises exactly one alignment recommendation when several signals agree", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreChecks: [
          { checked_at: daysAgo(10), nsf_depth: 3, osf_depth: 5, nsr_depth: 6, osr_depth: 6 },
        ],
        motAdvisories: [
          { test_date: daysAgo(60), text: "Tyre worn on outer edge", type: "ADVISORY" },
        ],
        visits: [{ on: daysAgo(20), description: "steering rack replaced" }],
      }),
    );
    const alignment = result.recommendations.filter((r) => r.serviceType === "alignment");
    expect(alignment).toHaveLength(1);
    expect(alignment[0].evidence.rule_key).toBe("alignment.axle_differential");
  });

  it("respects the alignment cooldown", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreChecks: [
          { checked_at: daysAgo(10), nsf_depth: 3, osf_depth: 5, nsr_depth: 6, osr_depth: 6 },
        ],
        serviceEvents: [
          { service_type: "alignment", performed_at: daysAgo(30), odometer_miles: 39_500 },
        ],
      }),
    );
    expect(result.recommendations.find((r) => r.serviceType === "alignment")).toBeUndefined();
  });
});

describe("evaluateTyreCare — balancing", () => {
  it("never marks balancing customer-contactable", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreChecks: [
          {
            checked_at: daysAgo(15),
            nsf_depth: 8,
            osf_depth: 8,
            nsr_depth: 8,
            osr_depth: 8,
            nsf_replaced: true,
          },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "balance")!;
    expect(rec.customerContactable).toBe(false);
    expect(rec.evidence.rule_key).toBe("balance.fitted_without_balance");
  });

  it("falls back to the mileage interval", () => {
    const result = evaluateTyreCare(
      baseInput({
        serviceEvents: [
          { service_type: "balance", performed_at: daysAgo(500), odometer_miles: 25_000 },
        ],
      }),
    );
    const rec = result.recommendations.find((r) => r.serviceType === "balance")!;
    expect(rec.evidence.rule_key).toBe("balance.interval");
    expect(rec.confidence).toBe("low");
    expect(rec.customerContactable).toBe(false);
  });
});

describe("evaluateTyreCare — quiet cases", () => {
  it("recommends nothing for a well-maintained vehicle", () => {
    const result = evaluateTyreCare(
      baseInput({
        tyreChecks: [
          { checked_at: daysAgo(10), nsf_depth: 6, osf_depth: 6, nsr_depth: 6, osr_depth: 6 },
        ],
        serviceEvents: [
          { service_type: "rotation", performed_at: daysAgo(30), odometer_miles: 39_800 },
          { service_type: "alignment", performed_at: daysAgo(30), odometer_miles: 39_800 },
          { service_type: "balance", performed_at: daysAgo(30), odometer_miles: 39_800 },
        ],
      }),
    );
    expect(result.recommendations).toHaveLength(0);
  });

  it("still returns a mileage estimate when nothing is due", () => {
    const result = evaluateTyreCare(baseInput());
    expect(result.mileage?.estimatedNow).toBeGreaterThan(40_000);
  });
});
