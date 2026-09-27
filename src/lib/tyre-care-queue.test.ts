import { describe, it, expect } from "vitest";
import {
  planRecommendations,
  DISMISS_SNOOZE_DAYS,
  type ExistingRecommendation,
  type FreshRecommendation,
} from "./tyre-care-queue";

const NOW = new Date("2026-09-27T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function fresh(overrides: Partial<FreshRecommendation> = {}): FreshRecommendation {
  return {
    vehicle_id: "v1",
    customer_id: "c1",
    service_type: "rotation",
    confidence: "low",
    evidence: { rule_key: "rotation.interval", rule_version: 1, inputs: {}, reason: "due" },
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingRecommendation> = {}): ExistingRecommendation {
  return {
    id: "r1",
    vehicle_id: "v1",
    service_type: "rotation",
    status: "pending_review",
    reviewed_at: null,
    sent_at: null,
    converted_at: null,
    ...overrides,
  };
}

const EVALUATED = new Set(["v1", "v2"]);

describe("planRecommendations", () => {
  it("queues a brand-new recommendation", () => {
    const plan = planRecommendations([], [fresh()], EVALUATED, NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.refreshes).toHaveLength(0);
  });

  it("refreshes a queued item instead of duplicating it", () => {
    const plan = planRecommendations(
      [existing()],
      [fresh({ confidence: "high" })],
      EVALUATED,
      NOW,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.refreshes).toEqual([
      expect.objectContaining({ id: "r1", confidence: "high" }),
    ]);
  });

  it("respects a recent dismissal", () => {
    const plan = planRecommendations(
      [existing({ status: "dismissed", reviewed_at: daysAgo(10) })],
      [fresh()],
      EVALUATED,
      NOW,
    );
    expect(plan.inserts).toHaveLength(0);
    expect(plan.held).toEqual([{ vehicle_id: "v1", service_type: "rotation", reason: "dismissed" }]);
  });

  it("lets a dismissed item resurface once the snooze has passed", () => {
    const plan = planRecommendations(
      [existing({ status: "dismissed", reviewed_at: daysAgo(DISMISS_SNOOZE_DAYS + 1) })],
      [fresh()],
      EVALUATED,
      NOW,
    );
    expect(plan.inserts).toHaveLength(1);
  });

  it("leaves a customer alone after they were recently asked or booked", () => {
    for (const row of [
      existing({ status: "approved_sent", sent_at: daysAgo(20) }),
      existing({ status: "converted", converted_at: daysAgo(20) }),
    ]) {
      const plan = planRecommendations([row], [fresh()], EVALUATED, NOW);
      expect(plan.inserts).toHaveLength(0);
      expect(plan.held[0].reason).toBe("contacted");
    }
  });

  it("expires a queued item whose trigger no longer holds", () => {
    const plan = planRecommendations([existing()], [], EVALUATED, NOW);
    expect(plan.expires).toEqual(["r1"]);
  });

  it("never expires items for vehicles the run didn't reach", () => {
    // A run cut short by its time budget must not wipe the rest of the queue.
    const plan = planRecommendations([existing({ vehicle_id: "v9" })], [], EVALUATED, NOW);
    expect(plan.expires).toHaveLength(0);
  });

  it("only touches the matching service", () => {
    const plan = planRecommendations(
      [existing({ id: "rot", service_type: "rotation" })],
      [fresh({ service_type: "alignment" })],
      EVALUATED,
      NOW,
    );
    expect(plan.inserts.map((i) => i.service_type)).toEqual(["alignment"]);
    expect(plan.expires).toEqual(["rot"]); // rotation no longer due
  });

  it("ignores expired and old terminal rows when deciding to queue", () => {
    const plan = planRecommendations(
      [
        existing({ id: "a", status: "expired" }),
        existing({ id: "b", status: "approved_sent", sent_at: daysAgo(400) }),
      ],
      [fresh()],
      EVALUATED,
      NOW,
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.expires).toHaveLength(0);
  });
});
