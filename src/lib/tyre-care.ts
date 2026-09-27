// Wheel & tyre care rules engine (#596, docs/tyre-care-build-spec.md, PR 3).
//
// Side-effect free and `now`-injected so every rule is unit-testable: the cron
// (PR 4) gathers the rows, this decides what is genuinely due and why. The
// "why" is the point — a recommendation the customer can't see the reasoning
// for is the one that gets them to unsubscribe, so every trigger carries
// structured evidence plus the plain-English sentence that goes in the message.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bump when a rule's logic changes, so stored evidence stays interpretable. */
export const RULE_VERSION = 1;

export const ROTATION_INTERVAL_MILES = 6_000;
export const BALANCE_INTERVAL_MILES = 12_000;

/** Cooldown: never re-recommend within 3 months OR 3,000 miles — the LONGER. */
export const COOLDOWN_DAYS = 90;
export const COOLDOWN_MILES = 3_000;

/** Same-axle left/right gap that reads as misalignment. */
export const AXLE_DIFF_MM = 1.5;
/** Front-vs-rear gap that corroborates a rotation being overdue. */
export const CROSS_AXLE_DIFF_MM = 1.0;

/** ~120k miles/year. Anything above is a typo or a unit mix-up, not a driver. */
const MAX_PLAUSIBLE_DAILY_MILES = 330;
/** Past this, the last reading is too stale to call the estimate trustworthy. */
const STALE_ANCHOR_DAYS = 548; // 18 months
/**
 * An MOT advisory older than this describes a car that has had another test
 * since — if the wear were still there, the newer test would say so.
 */
const ADVISORY_MAX_AGE_DAYS = 730;
/**
 * Evidence from a visit older than this no longer describes the car: a tyre
 * check, steering work, or a fitting from last year is history, not a reason
 * to contact someone today. The spec's own wording is "at last visit".
 */
export const RECENT_EVIDENCE_DAYS = 180;

export type ServiceType = "rotation" | "alignment" | "balance";
export type TyreConfig = "standard" | "directional" | "staggered" | "unknown";
export type Confidence = "high" | "low";
export type OdometerSource = "mot" | "job" | "tyre_check" | "history";

// ── Mileage estimation ───────────────────────────────────────────────────────

export type OdometerPoint = {
  /** YYYY-MM-DD or an ISO timestamp. */
  on: string;
  miles: number;
  source: OdometerSource;
};

export type MileageEstimate = {
  estimatedNow: number;
  avgDailyMiles: number;
  confidence: Confidence;
  pointCount: number;
  /** The reading the estimate is anchored to — the most recent usable one. */
  anchor: { on: string; miles: number; source: OdometerSource };
  daysSinceAnchor: number;
};

type TimedPoint = OdometerPoint & { t: number };

function cleanPoints(points: OdometerPoint[], now: Date): TimedPoint[] {
  const cutoff = now.getTime() + DAY_MS; // tolerate a same-day clock skew
  const usable = points
    .map((p) => ({ ...p, t: Date.parse(p.on) }))
    .filter(
      (p) =>
        Number.isFinite(p.t) &&
        p.t <= cutoff &&
        typeof p.miles === "number" &&
        Number.isFinite(p.miles) &&
        p.miles >= 0,
    )
    .sort((a, b) => a.t - b.t);

  // One reading per day — an MOT and a job on the same date are the same
  // moment for our purposes, and a zero-day gap would divide by zero below.
  // The higher reading wins: a vehicle only gains miles within a day.
  const byDay = new Map<string, TimedPoint>();
  for (const p of usable) {
    const key = new Date(p.t).toISOString().slice(0, 10);
    const existing = byDay.get(key);
    if (!existing || p.miles > existing.miles) byDay.set(key, p);
  }
  const daily = [...byDay.values()].sort((a, b) => a.t - b.t);

  // An odometer only goes up, so when two readings contradict each other one
  // of them is wrong — a clocked car, a typo, or a km figure filed as miles.
  //
  // Resolve it in favour of the NEWER reading, walking newest-to-oldest and
  // dropping any older row that exceeds one recorded after it. Sources
  // genuinely disagree in the field: a garage migrated from another system
  // carries `vehicle_history_entries` mileages that need not line up with
  // DVSA's. Trusting the older figure there would anchor the estimate to a
  // stale number, discard every fresh reading, and quote the customer a
  // mileage tens of thousands too high — and the spec is explicit that the
  // estimate re-anchors to the most recent reading.
  //
  // The same pass drops an older reading whose hop up to the trusted newer
  // one is faster than any car covers: that is a too-LOW typo (a dropped
  // digit), and keeping it would leave an impossible stretch in the series.
  const kept: TimedPoint[] = [];
  for (let i = daily.length - 1; i >= 0; i--) {
    const p = daily[i];
    const newer = kept[kept.length - 1];
    if (newer) {
      if (p.miles > newer.miles) continue;
      const days = (newer.t - p.t) / DAY_MS;
      if (days > 0 && (newer.miles - p.miles) / days > MAX_PLAUSIBLE_DAILY_MILES) continue;
    }
    kept.push(p);
  }
  kept.reverse();
  return kept;
}

/**
 * Weighted regression over the (date, odometer) series, biased to the most
 * recent readings and re-anchored to the latest one — MOT mileage alone is an
 * annual snapshot and can be twelve months stale.
 *
 * Returns null below two usable points: with one reading there is no rate to
 * project, and guessing would put a fabricated number in a customer message.
 */
export function estimateMileage(
  points: OdometerPoint[],
  now: Date = new Date(),
): MileageEstimate | null {
  const clean = cleanPoints(points, now);
  if (clean.length < 2) return null;

  // Per-segment rates rather than a least-squares line, so a long-ago quiet
  // spell doesn't drag down a car that is busy now. cleanPoints guarantees the
  // series never decreases; a hop no car could cover is still skipped here —
  // the anchor stands, only that stretch drops out of the rate.
  const segments: { rate: number }[] = [];
  for (let i = 1; i < clean.length; i++) {
    const days = (clean[i].t - clean[i - 1].t) / DAY_MS;
    if (days <= 0) continue;
    const rate = (clean[i].miles - clean[i - 1].miles) / days;
    if (rate > MAX_PLAUSIBLE_DAILY_MILES) continue;
    segments.push({ rate });
  }
  if (segments.length === 0) return null;

  // Geometric decay: each older hop counts half as much as the one after it,
  // so the recent 2–3 dominate while history still pulls an outlier back.
  // A flat-ish weighting let one quiet year mask a car now doing 40 a day.
  let weightSum = 0;
  let rateSum = 0;
  segments.forEach((seg, i) => {
    const weight = Math.pow(0.5, segments.length - 1 - i);
    weightSum += weight;
    rateSum += weight * seg.rate;
  });
  const avgDailyMiles = rateSum / weightSum;

  const anchor = clean[clean.length - 1];
  const daysSinceAnchor = Math.max(0, (now.getTime() - anchor.t) / DAY_MS);
  const estimatedNow = Math.round(anchor.miles + avgDailyMiles * daysSinceAnchor);

  return {
    estimatedNow,
    avgDailyMiles: Math.round(avgDailyMiles * 100) / 100,
    confidence: clean.length >= 3 && daysSinceAnchor <= STALE_ANCHOR_DAYS ? "high" : "low",
    pointCount: clean.length,
    anchor: { on: anchor.on, miles: anchor.miles, source: anchor.source },
    daysSinceAnchor: Math.round(daysSinceAnchor),
  };
}

// ── Powertrain ───────────────────────────────────────────────────────────────

/**
 * EVs and heavy hybrids wear tyres faster — kerb weight plus instant torque —
 * so their service intervals shorten rather than sharing one global default.
 * DVLA VES reports "ELECTRICITY" for pure EVs and "HYBRID ELECTRIC" for
 * hybrids, so hybrid must be tested first: both match /electric/.
 */
export function powertrainMultiplier(fuelType: string | null | undefined): number {
  if (!fuelType) return 1;
  if (/hybrid/i.test(fuelType)) return 0.9;
  if (/electric/i.test(fuelType)) return 0.8;
  return 1;
}

// ── Tread analysis ───────────────────────────────────────────────────────────

export type TyreCheck = {
  checked_at: string;
  nsf_depth: number | null;
  osf_depth: number | null;
  nsr_depth: number | null;
  osr_depth: number | null;
  nsf_replaced?: boolean;
  osf_replaced?: boolean;
  nsr_replaced?: boolean;
  osr_replaced?: boolean;
  /** Mileage at the check — makes a tyre fitting usable as a rotation baseline. */
  odometer_miles?: number | null;
};

export type TreadAnalysis = {
  checkedAt: string;
  /** Largest left-vs-right gap on a single axle — the misalignment signature. */
  axleDifferential: number | null;
  /** Front-average vs rear-average gap — evidence a rotation is due. */
  crossAxleDiff: number | null;
  /**
   * Which axle is more worn. Front-wheel-drive cars wear the fronts first,
   * rear-wheel-drive the rears — a message must name the right one.
   */
  frontWornMore: boolean | null;
  anyReplaced: boolean;
};

function gap(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
}

/** Newest check only — tread differentials describe the car's state today. */
export function analyseTread(checks: TyreCheck[]): TreadAnalysis | null {
  const sorted = [...checks]
    .filter((c) => Number.isFinite(Date.parse(c.checked_at)))
    .sort((a, b) => Date.parse(b.checked_at) - Date.parse(a.checked_at));
  const latest = sorted[0];
  if (!latest) return null;

  const front = gap(latest.nsf_depth, latest.osf_depth);
  const rear = gap(latest.nsr_depth, latest.osr_depth);
  const axleDifferential =
    front === null && rear === null ? null : Math.max(front ?? 0, rear ?? 0);

  const frontAvg = mean([latest.nsf_depth, latest.osf_depth]);
  const rearAvg = mean([latest.nsr_depth, latest.osr_depth]);

  const bothAxles = frontAvg !== null && rearAvg !== null;
  return {
    checkedAt: latest.checked_at,
    axleDifferential,
    crossAxleDiff: bothAxles ? Math.abs(frontAvg - rearAvg) : null,
    // Less tread left = more worn.
    frontWornMore: bothAxles && frontAvg !== rearAvg ? frontAvg < rearAvg : null,
    anyReplaced: anyTyreReplaced(latest),
  };
}

function anyTyreReplaced(check: TyreCheck): boolean {
  return Boolean(check.nsf_replaced || check.osf_replaced || check.nsr_replaced || check.osr_replaced);
}

/** "the front tyres have worn about 2.0mm more than the rears" */
function wearClause(tread: TreadAnalysis): string {
  const [worse, better] = tread.frontWornMore ? ["front", "rears"] : ["rear", "fronts"];
  return `the ${worse} tyres have worn about ${tread.crossAxleDiff!.toFixed(1)}mm more than the ${better}`;
}

// MOT advisory wording is free-form and inconsistent, so match the shapes that
// actually describe a wear pattern rather than trying to parse the sentence.
const ALIGNMENT_ADVISORY =
  /(?:inner|outer|inside|outside|edge|shoulder)[^.]{0,40}(?:wear|worn)|(?:wear|worn)[^.]{0,40}(?:inner|outer|inside|outside|edge|shoulder)|uneven(?:ly)?\s+worn|worn\s+uneven(?:ly)?/i;

/** Work on the last visit that should have been followed by an alignment. */
const STEERING_WORK =
  /\b(?:track\s*rod|tie\s*rod|steering|suspension|wishbone|control\s*arm|shock\s*absorber|strut|coil\s*spring|ball\s*joint)\b/i;

export function matchesAlignmentAdvisory(text: string | null | undefined): boolean {
  return typeof text === "string" && ALIGNMENT_ADVISORY.test(text);
}

export function isSteeringWork(text: string | null | undefined): boolean {
  return typeof text === "string" && STEERING_WORK.test(text);
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export type WheelServiceEvent = {
  service_type: ServiceType;
  performed_at: string;
  odometer_miles: number | null;
};

export type MotAdvisory = { test_date: string; text: string; type: string };

export type VisitRecord = {
  /** ISO date of the visit. */
  on: string;
  description: string | null;
};

export type TyreCareInput = {
  now?: Date;
  fuelType: string | null;
  tyreConfig: TyreConfig | null;
  odometerPoints: OdometerPoint[];
  tyreChecks: TyreCheck[];
  motAdvisories: MotAdvisory[];
  serviceEvents: WheelServiceEvent[];
  /** Recent jobs — read for steering/suspension work. */
  visits: VisitRecord[];
  thresholds?: { rotationMiles?: number; balanceMiles?: number };
};

export type Evidence = {
  rule_key: string;
  rule_version: number;
  inputs: Record<string, unknown>;
  /** Plain-English, customer-facing. This is what goes in the message. */
  reason: string;
};

export type TyreRecommendation = {
  serviceType: ServiceType;
  confidence: Confidence;
  evidence: Evidence;
  /**
   * False for balancing: the signal is too weak to message a customer about,
   * so it surfaces as a point-of-service prompt on the job card instead.
   */
  customerContactable: boolean;
  /** Rotation on a vehicle whose wheel profile nobody has confirmed yet. */
  requiresWheelProfile?: boolean;
};

export type TyreCareResult = {
  mileage: MileageEstimate | null;
  tread: TreadAnalysis | null;
  recommendations: TyreRecommendation[];
  /** Why a service produced nothing — surfaced in the staff queue, not sent. */
  suppressions: { serviceType: ServiceType; reason: string }[];
};

function lastEvent(events: WheelServiceEvent[], type: ServiceType): WheelServiceEvent | null {
  const matching = events
    .filter((e) => e.service_type === type && Number.isFinite(Date.parse(e.performed_at)))
    .sort((a, b) => Date.parse(b.performed_at) - Date.parse(a.performed_at));
  return matching[0] ?? null;
}

/**
 * True while the work is still recent enough that recommending it again would
 * look careless. Both clocks must have elapsed — "3 months or 3,000 miles,
 * whichever is longer" — and an unknown mileage falls back to the date alone.
 */
function inCooldown(
  event: WheelServiceEvent | null,
  now: Date,
  estimatedNow: number | null,
): { cooling: boolean; daysSince: number | null; milesSince: number | null } {
  if (!event) return { cooling: false, daysSince: null, milesSince: null };
  const performed = Date.parse(event.performed_at);
  if (!Number.isFinite(performed)) return { cooling: false, daysSince: null, milesSince: null };

  const daysSince = Math.floor((now.getTime() - performed) / DAY_MS);
  const milesSince =
    estimatedNow !== null && event.odometer_miles !== null
      ? estimatedNow - event.odometer_miles
      : null;

  const dateCooling = daysSince < COOLDOWN_DAYS;
  const mileageCooling = milesSince !== null && milesSince < COOLDOWN_MILES;
  return { cooling: dateCooling || mileageCooling, daysSince, milesSince };
}

function formatMiles(miles: number): string {
  return Math.round(miles).toLocaleString("en-GB");
}

type RotationBaseline = { kind: "rotation" | "fitment"; on: string; miles: number };

/**
 * Where "miles since rotation" is measured from: the more recent of the last
 * recorded rotation and the last time new tyres went on. A fitting restarts
 * the schedule whether two tyres or four were replaced — new tyres normally go
 * on the rear and rotation resumes from there. Only rows that carry a mileage
 * count: a fitting with no odometer reading cannot anchor a distance.
 */
function rotationBaseline(
  rotation: WheelServiceEvent | null,
  checks: TyreCheck[],
): RotationBaseline | null {
  const candidates: (RotationBaseline & { t: number })[] = [];
  if (rotation?.odometer_miles != null) {
    const t = Date.parse(rotation.performed_at);
    if (Number.isFinite(t)) {
      candidates.push({ kind: "rotation", on: rotation.performed_at, miles: rotation.odometer_miles, t });
    }
  }
  for (const c of checks) {
    if (!anyTyreReplaced(c) || c.odometer_miles == null) continue;
    const t = Date.parse(c.checked_at);
    if (Number.isFinite(t)) candidates.push({ kind: "fitment", on: c.checked_at, miles: c.odometer_miles, t });
  }
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((a, b) => (b.t > a.t ? b : a));
  return { kind: latest.kind, on: latest.on, miles: latest.miles };
}

export function evaluateTyreCare(input: TyreCareInput): TyreCareResult {
  const now = input.now ?? new Date();
  const multiplier = powertrainMultiplier(input.fuelType);
  const rotationInterval = Math.round(
    (input.thresholds?.rotationMiles ?? ROTATION_INTERVAL_MILES) * multiplier,
  );
  const balanceInterval = Math.round(
    (input.thresholds?.balanceMiles ?? BALANCE_INTERVAL_MILES) * multiplier,
  );

  const mileage = estimateMileage(input.odometerPoints, now);
  const tread = analyseTread(input.tyreChecks);
  const estimatedNow = mileage?.estimatedNow ?? null;

  const recommendations: TyreRecommendation[] = [];
  const suppressions: { serviceType: ServiceType; reason: string }[] = [];

  /** Recent enough to act on, and after the service it would justify. */
  const actionable = (iso: string, lastServiceAt: number | null): boolean => {
    const t = Date.parse(iso);
    return (
      Number.isFinite(t) &&
      now.getTime() - t <= RECENT_EVIDENCE_DAYS * DAY_MS &&
      (lastServiceAt === null || t > lastServiceAt)
    );
  };

  // ── Rotation ───────────────────────────────────────────────────────────────
  const rotationBlocked = input.tyreConfig === "staggered" || input.tyreConfig === "directional";
  const rotationEvent = lastEvent(input.serviceEvents, "rotation");
  const rotationCooldown = inCooldown(rotationEvent, now, estimatedNow);

  if (rotationBlocked) {
    suppressions.push({
      serviceType: "rotation",
      reason:
        input.tyreConfig === "staggered"
          ? "Staggered fitment — front and rear tyres are different sizes, so they cannot be rotated."
          : "Directional tyres — front-to-back on the same side only, so a standard rotation does not apply.",
    });
  } else if (rotationCooldown.cooling) {
    suppressions.push({
      serviceType: "rotation",
      reason: `Rotated ${rotationCooldown.daysSince} days ago — inside the cooldown.`,
    });
  } else {
    const rotatedAt = rotationEvent ? Date.parse(rotationEvent.performed_at) : null;
    const baseline = rotationBaseline(rotationEvent, input.tyreChecks);
    const since = estimatedNow !== null && baseline ? estimatedNow - baseline.miles : null;

    // Measured front/rear wear is evidence on its own — it needs no mileage
    // history at all. It must be recent, and must post-date the last rotation:
    // a differential measured before the tyres were swapped describes wear
    // the rotation already dealt with.
    const treadFresh =
      tread !== null &&
      tread.crossAxleDiff !== null &&
      tread.crossAxleDiff >= CROSS_AXLE_DIFF_MM &&
      actionable(tread.checkedAt, rotatedAt);

    if (baseline && since !== null && since >= rotationInterval) {
      const sinceWhat = baseline.kind === "fitment" ? "your new tyres were fitted" : "your tyres were rotated";
      recommendations.push({
        serviceType: "rotation",
        confidence: treadFresh ? "high" : "low",
        customerContactable: true,
        requiresWheelProfile: input.tyreConfig !== "standard",
        evidence: {
          rule_key: "rotation.interval",
          rule_version: RULE_VERSION,
          inputs: {
            estimated_mileage_now: estimatedNow,
            baseline_kind: baseline.kind,
            baseline_on: baseline.on,
            baseline_miles: baseline.miles,
            miles_since_baseline: Math.round(since),
            rotation_interval: rotationInterval,
            powertrain_multiplier: multiplier,
            cross_axle_diff_mm: treadFresh ? tread!.crossAxleDiff : null,
            mileage_confidence: mileage?.confidence ?? null,
          },
          reason: treadFresh
            ? `Your last recorded reading suggests about ${formatMiles(since)} miles since ${sinceWhat}, and ${wearClause(tread!)}.`
            : `Your last recorded reading suggests you've covered about ${formatMiles(since)} miles since ${sinceWhat}.`,
        },
      });
    } else if (treadFresh) {
      recommendations.push({
        serviceType: "rotation",
        confidence: "high",
        customerContactable: true,
        requiresWheelProfile: input.tyreConfig !== "standard",
        evidence: {
          rule_key: "rotation.tread_differential",
          rule_version: RULE_VERSION,
          inputs: {
            cross_axle_diff_mm: tread!.crossAxleDiff,
            front_worn_more: tread!.frontWornMore,
            threshold_mm: CROSS_AXLE_DIFF_MM,
            checked_at: tread!.checkedAt,
          },
          reason: `At your last check ${wearClause(tread!)} — rotating them evens out the wear and gets more life from the set.`,
        },
      });
    } else if (!baseline) {
      suppressions.push({
        serviceType: "rotation",
        reason: "No rotation or new-tyre fitting on record with a mileage to measure from.",
      });
    } else if (estimatedNow === null) {
      suppressions.push({
        serviceType: "rotation",
        reason: "Not enough odometer readings to estimate mileage (two or more needed).",
      });
    }
    // Otherwise it was measured and simply isn't due yet — nothing to report.
  }

  // ── Alignment ──────────────────────────────────────────────────────────────
  const alignmentEvent = lastEvent(input.serviceEvents, "alignment");
  const alignmentCooldown = inCooldown(alignmentEvent, now, estimatedNow);
  const alignedAt = alignmentEvent ? Date.parse(alignmentEvent.performed_at) : null;

  if (alignmentCooldown.cooling) {
    suppressions.push({
      serviceType: "alignment",
      reason: `Aligned ${alignmentCooldown.daysSince} days ago — inside the cooldown.`,
    });
  } else {
    // Strongest signal first: measured tread, then MOT wording, then events.
    // Every signal must post-date the last alignment — otherwise the car has
    // already had the work and we'd be recommending it again from old news.
    const advisory = input.motAdvisories.find((a) => {
      const tested = Date.parse(a.test_date);
      return (
        matchesAlignmentAdvisory(a.text) &&
        Number.isFinite(tested) &&
        now.getTime() - tested <= ADVISORY_MAX_AGE_DAYS * DAY_MS &&
        (alignedAt === null || tested > alignedAt)
      );
    });
    const steeringVisit = input.visits.find(
      (v) => isSteeringWork(v.description) && actionable(v.on, alignedAt),
    );
    const newTyresUnaligned = tread?.anyReplaced && actionable(tread.checkedAt, alignedAt);

    if (
      tread?.axleDifferential != null &&
      tread.axleDifferential >= AXLE_DIFF_MM &&
      actionable(tread.checkedAt, alignedAt)
    ) {
      recommendations.push({
        serviceType: "alignment",
        confidence: "high",
        customerContactable: true,
        evidence: {
          rule_key: "alignment.axle_differential",
          rule_version: RULE_VERSION,
          inputs: {
            axle_differential_mm: tread.axleDifferential,
            threshold_mm: AXLE_DIFF_MM,
            checked_at: tread.checkedAt,
          },
          reason: `At your last check one side of an axle had worn ${tread.axleDifferential.toFixed(1)}mm more than the other, which usually points to the alignment being out.`,
        },
      });
    } else if (advisory) {
      recommendations.push({
        serviceType: "alignment",
        confidence: "high",
        customerContactable: true,
        evidence: {
          rule_key: "alignment.mot_advisory",
          rule_version: RULE_VERSION,
          inputs: { advisory_text: advisory.text, test_date: advisory.test_date },
          reason: `Your last MOT noted uneven tyre wear ("${advisory.text.trim()}"), which an alignment check would address.`,
        },
      });
    } else if (steeringVisit) {
      recommendations.push({
        serviceType: "alignment",
        confidence: "high",
        customerContactable: true,
        evidence: {
          rule_key: "alignment.after_steering_work",
          rule_version: RULE_VERSION,
          inputs: { visit_on: steeringVisit.on, work: steeringVisit.description },
          reason:
            "Steering or suspension work was carried out without an alignment check afterwards, which is when the geometry most often shifts.",
        },
      });
    } else if (newTyresUnaligned) {
      recommendations.push({
        serviceType: "alignment",
        confidence: "high",
        customerContactable: true,
        evidence: {
          rule_key: "alignment.new_tyres_unaligned",
          rule_version: RULE_VERSION,
          inputs: { checked_at: tread!.checkedAt },
          reason:
            "New tyres were fitted without an alignment check, so they may be wearing unevenly from the start.",
        },
      });
    }
  }

  // ── Balancing (staff prompt only) ──────────────────────────────────────────
  // The weakest signal of the three: realistically attach-on-fit or
  // symptom-driven, not something mileage predicts. It never messages a
  // customer — it surfaces at the point of service.
  const balanceEvent = lastEvent(input.serviceEvents, "balance");
  const balanceCooldown = inCooldown(balanceEvent, now, estimatedNow);
  const balancedAt = balanceEvent ? Date.parse(balanceEvent.performed_at) : null;

  if (balanceCooldown.cooling) {
    suppressions.push({
      serviceType: "balance",
      reason: `Balanced ${balanceCooldown.daysSince} days ago — inside the cooldown.`,
    });
  } else {
    const fittedUnbalanced = tread?.anyReplaced && actionable(tread.checkedAt, balancedAt);
    const sinceBalance =
      estimatedNow !== null && balanceEvent?.odometer_miles != null
        ? estimatedNow - balanceEvent.odometer_miles
        : null;

    if (fittedUnbalanced) {
      recommendations.push({
        serviceType: "balance",
        confidence: "high",
        customerContactable: false,
        evidence: {
          rule_key: "balance.fitted_without_balance",
          rule_version: RULE_VERSION,
          inputs: { checked_at: tread!.checkedAt },
          reason: "Tyres were replaced with no wheel balance recorded against the visit.",
        },
      });
    } else if (sinceBalance !== null && sinceBalance >= balanceInterval) {
      recommendations.push({
        serviceType: "balance",
        confidence: "low",
        customerContactable: false,
        evidence: {
          rule_key: "balance.interval",
          rule_version: RULE_VERSION,
          inputs: {
            estimated_mileage_now: estimatedNow,
            miles_since_balance: Math.round(sinceBalance),
            balance_interval: balanceInterval,
            powertrain_multiplier: multiplier,
          },
          reason: `About ${formatMiles(sinceBalance)} miles since the wheels were last balanced.`,
        },
      });
    }
  }

  return { mileage, tread, recommendations, suppressions };
}
