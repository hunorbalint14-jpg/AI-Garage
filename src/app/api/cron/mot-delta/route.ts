import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { recordCronRun } from "@/lib/platform/cron-runs";
import {
  listBulkDownloadFiles,
  downloadDeltaFile,
  scanDeltaZip,
  normalizeRegistration,
  type BulkFileInfo,
  type DeltaVehicleUpdate,
} from "@/lib/dvsa-bulk";
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

export const runtime = "nodejs";
export const maxDuration = 60;

// Nightly MOT delta sync. Downloads the DVSA daily delta files (full record
// for every GB/NI vehicle whose MOT data changed in the last 24h), matches
// registrations against our vehicles table and:
//   1. refreshes mot_expiry / last_mot_test_date without burning
//      per-registration API calls;
//   2. flags vehicles MOT'd with no booking or job here around the test date
//      (moted_elsewhere_at) — the lapsed-customer win-back signal.
// Each delta file is processed once (mot_delta_runs.filename is unique);
// unprocessed files left when the time budget runs out are picked up the
// next night. DELETED modifications are ignored — we never remove customer
// data on DVSA's say-so.
//
// A delta only ever carries vehicles whose MOT data changed that day, so it
// cannot correct a stored expiry whose test predates our sync. cron/mot-reconcile
// covers that gap; the diff / "MOT'd elsewhere" / write rules both jobs apply
// live in src/lib/mot-sync.ts.

const TIME_BUDGET_MS = 45_000; // leave headroom inside maxDuration

async function loadAllVehicles(admin: ReturnType<typeof createAdminClient>) {
  const byReg = new Map<string, MotVehicleRow[]>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("vehicles")
      .select(MOT_VEHICLE_COLUMNS)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`vehicles page load failed: ${error.message}`);
    const rows = (data ?? []) as MotVehicleRow[];
    for (const row of rows) {
      const key = normalizeRegistration(row.registration);
      const list = byReg.get(key);
      if (list) list.push(row);
      else byReg.set(key, [row]);
    }
    if (rows.length < pageSize) break;
  }
  return byReg;
}

function collectMatches(
  update: DeltaVehicleUpdate,
  byReg: Map<string, MotVehicleRow[]>,
  out: PendingMotUpdate[],
): number {
  if (update.modification === "DELETED") return 0;
  const rows = byReg.get(update.normalizedReg);
  if (!rows) return 0;

  for (const vehicle of rows) {
    const pending = diffMotUpdate(update, vehicle);
    if (pending) out.push(pending);
  }
  return rows.length;
}

async function processFile(
  admin: ReturnType<typeof createAdminClient>,
  file: BulkFileInfo,
  byReg: Map<string, MotVehicleRow[]>,
) {
  const t0 = Date.now();
  let scanned = 0;
  let matched = 0;
  const pending: PendingMotUpdate[] = [];
  const testRows: MotTestRow[] = [];

  try {
    const zip = await downloadDeltaFile(file);
    const result = await scanDeltaZip(zip, (update) => {
      matched += collectMatches(update, byReg, pending);
      // Persist the full test series for every matched vehicle (#596) — the
      // delta record is the complete history, and it only appears on the day
      // the vehicle's MOT data changed, so this is the cheap refresh moment.
      if (update.modification !== "DELETED" && update.tests.length > 0) {
        for (const vehicle of byReg.get(update.normalizedReg) ?? []) {
          testRows.push(...motTestRowsFor(update, vehicle, "delta"));
        }
      }
    });
    scanned = result.scanned;

    const elsewhere = await findMotedElsewhere(admin, pending);

    // Also keeps the in-memory map current so later files in this run diff correctly.
    const updated = await applyMotUpdates(admin, pending, elsewhere, new Date().toISOString());

    // Enrichment, not correctness: a failed mot_tests write must not fail the
    // file (the expiry/win-back updates above already landed).
    const persisted = await persistMotTests(admin, testRows);

    await admin.from("mot_delta_runs").insert({
      filename: file.filename,
      file_created_on: file.fileCreatedOn || null,
      status: "done",
      scanned_count: scanned,
      matched_count: matched,
      updated_count: updated,
      moted_elsewhere_count: elsewhere.size,
      duration_ms: Date.now() - t0,
    });
    return {
      updated,
      elsewhere: elsewhere.size,
      tests: persisted.upserted,
      testsFailed: persisted.failed,
      testsError: persisted.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("mot_delta_runs").insert({
      filename: file.filename,
      file_created_on: file.fileCreatedOn || null,
      status: "error",
      scanned_count: scanned,
      matched_count: matched,
      error: message.slice(0, 500),
      duration_ms: Date.now() - t0,
    });
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const __t0 = Date.now();

  let listing;
  try {
    listing = await listBulkDownloadFiles();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCronRun(admin, "cron/mot-delta", false, Date.now() - __t0, message.slice(0, 200));
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: doneRows, error: doneErr } = await admin
    .from("mot_delta_runs")
    .select("filename")
    .eq("status", "done");
  if (doneErr) {
    return NextResponse.json({ error: doneErr.message }, { status: 500 });
  }
  const done = new Set((doneRows ?? []).map((r: { filename: string }) => r.filename));

  const pendingFiles = listing.delta
    .filter((f) => !done.has(f.filename))
    .sort((a, b) => a.fileCreatedOn.localeCompare(b.fileCreatedOn));

  if (pendingFiles.length === 0) {
    await recordCronRun(admin, "cron/mot-delta", true, Date.now() - __t0, "no new delta files");
    return NextResponse.json({ success: true, processed: 0 });
  }

  const byReg = await loadAllVehicles(admin);

  let processed = 0;
  let updated = 0;
  let elsewhere = 0;
  let tests = 0;
  let testsFailed = 0;
  let testsError: string | null = null;
  let failure: string | null = null;

  for (const file of pendingFiles) {
    if (Date.now() - __t0 > TIME_BUDGET_MS) break; // remaining files run next night
    try {
      const result = await processFile(admin, file, byReg);
      processed++;
      updated += result.updated;
      elsewhere += result.elsewhere;
      tests += result.tests;
      testsFailed += result.testsFailed;
      if (result.testsError) testsError = result.testsError;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      break; // keep ordering: don't skip a failed day's file
    }
  }

  const detail = `files ${processed}/${pendingFiles.length}, updated ${updated}, elsewhere ${elsewhere}, tests ${tests}${testsFailed ? `, tests dropped ${testsFailed}` : ""}${testsError ? `, tests error: ${testsError.slice(0, 80)}` : ""}${failure ? `, error: ${failure.slice(0, 120)}` : ""}`;
  await recordCronRun(admin, "cron/mot-delta", failure === null, Date.now() - __t0, detail);

  if (failure !== null) {
    return NextResponse.json({ error: failure, processed, updated }, { status: 502 });
  }
  return NextResponse.json({
    success: true,
    processed,
    pending: pendingFiles.length - processed,
    updated,
    moted_elsewhere: elsewhere,
    mot_tests_upserted: tests,
    mot_tests_dropped: testsFailed,
  });
}
