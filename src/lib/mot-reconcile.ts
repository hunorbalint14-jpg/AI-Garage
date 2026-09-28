import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchDvsaVehicleRecord } from "@/lib/dvla";
import { extractDeltaUpdate, normalizeRegistration } from "@/lib/dvsa-bulk";
import { persistMotTests, type MotTestRow } from "@/lib/mot-history";
import {
  MOT_VEHICLE_COLUMNS,
  applyMotUpdates,
  diffMotUpdate,
  findMotedElsewhere,
  motTestRowsFor,
  type MotVehicleRow,
  type PendingMotUpdate,
} from "@/lib/mot-sync";

type Admin = ReturnType<typeof createAdminClient>;

// Nightly MOT reconcile — the backstop for what the delta sync cannot see.
//
// cron/mot-delta only ever receives vehicles whose MOT data changed that day.
// A vehicle whose test happened before we were watching — imported from an old
// DMS, added after its MOT, or tested on a night the delta job failed — is
// never emitted again until its NEXT test, so its stored expiry stays wrong for
// up to a year: the app shows it overdue when it was MOT'd elsewhere long ago.
//
// So: look up, one registration at a time, the vehicles whose stored expiry has
// passed or falls inside the reminder window (or is missing), and apply DVSA's
// record through the same diff / "MOT'd elsewhere" / write rules as the delta.

/** Covers the default 30-day MOT reminder lead time with margin, so a reminder
 *  is never sent off an expiry nobody has checked against DVSA. */
export const LOOKAHEAD_DAYS = 45;
/** A vehicle DVSA confirmed within this window isn't re-queried — a genuinely
 *  lapsed (SORN, scrapped, exported) car shouldn't cost a call every night. */
export const RECHECK_AFTER_DAYS = 14;
/** Distinct registrations per run. Bounds DVSA API spend regardless of fleet
 *  size; a large backlog (e.g. right after an import) drains over nights. */
export const MAX_REGISTRATIONS_PER_RUN = 200;
const CONCURRENCY = 4;
const DEFAULT_TIME_BUDGET_MS = 45_000;
const STAMP_CHUNK = 500;

export type ReconcileResult = {
  /** Distinct registrations selected for this run. */
  candidates: number;
  /** Registrations DVSA answered for (a record, or a definite not-found). */
  checked: number;
  /** Vehicle rows whose expiry or last-test date changed. */
  updated: number;
  elsewhere: number;
  notFound: number;
  /** Per-registration failures; those vehicles are retried next run. */
  errors: number;
  tests: number;
  testsError: string | null;
  /** Why the run ended before checking every candidate, if it did. */
  stoppedEarly: string | null;
  /** True when the stop was systemic (bad key, auth, quota) — the run failed. */
  failed: boolean;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Candidates grouped by normalised registration, so a car on the books at two
 * orgs costs one lookup. Never-checked vehicles first, then the soonest-due /
 * most recently expired — the ones a reminder or an "overdue" badge hits next.
 */
export async function loadReconcileCandidates(
  admin: Admin,
  now: Date,
  maxRegistrations = MAX_REGISTRATIONS_PER_RUN,
): Promise<Map<string, MotVehicleRow[]>> {
  const dueBy = new Date(now);
  dueBy.setUTCDate(dueBy.getUTCDate() + LOOKAHEAD_DAYS);
  const recheckBefore = new Date(now);
  recheckBefore.setUTCDate(recheckBefore.getUTCDate() - RECHECK_AFTER_DAYS);

  const { data, error } = await admin
    .from("vehicles")
    .select(MOT_VEHICLE_COLUMNS)
    .or(`mot_expiry.is.null,mot_expiry.lte.${isoDate(dueBy)}`)
    .or(`mot_synced_at.is.null,mot_synced_at.lt.${isoDate(recheckBefore)}`)
    .not("registration", "is", null)
    .order("mot_synced_at", { ascending: true, nullsFirst: true })
    .order("mot_expiry", { ascending: false, nullsFirst: false })
    // Rows, not registrations — headroom for the same reg at several orgs.
    .limit(maxRegistrations * 3);
  if (error) throw new Error(`reconcile candidate load failed: ${error.message}`);

  const byReg = new Map<string, MotVehicleRow[]>();
  for (const row of (data ?? []) as MotVehicleRow[]) {
    const key = normalizeRegistration(row.registration ?? "");
    if (!key) continue;
    const list = byReg.get(key);
    if (list) list.push(row);
    else if (byReg.size < maxRegistrations) byReg.set(key, [row]);
  }
  return byReg;
}

export async function reconcileStaleMotExpiries(
  admin: Admin,
  opts: { now?: Date; maxRegistrations?: number; timeBudgetMs?: number } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const timeBudgetMs = opts.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const started = Date.now();

  const byReg = await loadReconcileCandidates(admin, now, opts.maxRegistrations);
  const regs = [...byReg.keys()];

  const pending: PendingMotUpdate[] = [];
  const testRows: MotTestRow[] = [];
  // Vehicles DVSA answered for with nothing to change — stamped so they wait
  // RECHECK_AFTER_DAYS rather than being re-queried tomorrow.
  const confirmedIds: string[] = [];
  let checked = 0;
  let notFound = 0;
  let errors = 0;
  let stoppedEarly: string | null = null;
  let failed = false;

  for (let i = 0; i < regs.length && !stoppedEarly; i += CONCURRENCY) {
    if (Date.now() - started > timeBudgetMs) {
      stoppedEarly = `time budget reached — ${regs.length - i} left for the next run`;
      break;
    }
    const batch = regs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((reg) => fetchDvsaVehicleRecord(reg)));

    batch.forEach((reg, j) => {
      const vehicles = byReg.get(reg)!;
      const res = results[j];
      switch (res.status) {
        case "systemic":
          // Every later call would fail the same way. Keep what this batch
          // already got, then stop.
          stoppedEarly ??= res.error;
          failed = true;
          return;
        case "error":
          errors++;
          return;
        case "not_found":
          checked++;
          notFound++;
          confirmedIds.push(...vehicles.map((v) => v.id));
          return;
        case "ok": {
          const update = extractDeltaUpdate(res.record);
          if (!update) {
            errors++;
            return;
          }
          checked++;
          for (const v of vehicles) {
            const change = diffMotUpdate(update, v);
            if (change) pending.push(change);
            else confirmedIds.push(v.id);
            testRows.push(...motTestRowsFor(update, v, "lookup"));
          }
        }
      }
    });
  }

  const nowIso = now.toISOString();
  const elsewhere = await findMotedElsewhere(admin, pending);
  const updated = await applyMotUpdates(admin, pending, elsewhere, nowIso);

  for (let i = 0; i < confirmedIds.length; i += STAMP_CHUNK) {
    const { error } = await admin
      .from("vehicles")
      .update({ mot_synced_at: nowIso })
      .in("id", confirmedIds.slice(i, i + STAMP_CHUNK));
    if (error) throw new Error(`mot_synced_at stamp failed: ${error.message}`);
  }

  // Enrichment, not correctness — never fails the run.
  const persisted = await persistMotTests(admin, testRows);

  return {
    candidates: regs.length,
    checked,
    updated,
    elsewhere: elsewhere.size,
    notFound,
    errors,
    tests: persisted.upserted,
    testsError: persisted.error,
    stoppedEarly,
    failed,
  };
}
