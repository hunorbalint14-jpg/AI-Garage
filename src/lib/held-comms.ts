import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { HELD_KINDS, HELD_KIND_LABELS, type HeldKind } from "@/lib/held-comms-shared";

type Admin = ReturnType<typeof createAdminClient>;

// Rows a prelive branch would have sent (#586). Recorded by the cron routes in
// place of the send, read by the Go-live screen.
//
// The table is a PENDING SET keyed (location, kind, ref) — every run upserts,
// refreshing last_seen_at. Anything that stops qualifying simply stops being
// refreshed and ages out of STALE_AFTER_HOURS, so a paid invoice or cancelled
// booking doesn't sit in the owner's "what will send" count forever.

export type HeldRow = {
  locationId: string;
  kind: HeldKind;
  customerId: string | null;
  refTable: string;
  refId: string;
  summary: string;
};

/** Counts only what the crons have confirmed recently — see the ageing note above. */
export const STALE_AFTER_HOURS = 48;

/** Rows are deleted once they've gone unseen this long, so the table stays small. */
const PRUNE_AFTER_DAYS = 7;

/** Sample lines shown per kind on the Go-live screen. */
export const SAMPLE_LIMIT = 3;

// Never throws: holding a comm must not be able to break a cron run. A failed
// record means the Go-live screen under-reports, which is recoverable; a thrown
// error would stop the rest of the run, which is not.
export async function recordHeld(admin: Admin, rows: HeldRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const nowIso = new Date().toISOString();
  try {
    const { error } = await admin.from("held_comms").upsert(
      rows.map((r) => ({
        location_id: r.locationId,
        kind: r.kind,
        customer_id: r.customerId,
        ref_table: r.refTable,
        ref_id: r.refId,
        summary: r.summary.slice(0, 300),
        would_have_sent_at: nowIso,
        last_seen_at: nowIso,
      })),
      { onConflict: "location_id,kind,ref_id" },
    );
    if (error) {
      console.error("[held-comms] record failed", error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.error("[held-comms] record threw", err);
    return 0;
  }
}

export type HeldGroup = {
  kind: HeldKind;
  label: string;
  count: number;
  samples: string[];
};

export type HeldSummary = {
  total: number;
  groups: HeldGroup[];
  /** Oldest still-pending hold — how long the branch has been quiet for. */
  oldestAt: string | null;
};

type HeldRecord = {
  kind: string;
  summary: string;
  would_have_sent_at: string;
};

/**
 * What would send if this branch went live now, grouped by kind.
 *
 * Reads only rows the crons have confirmed within STALE_AFTER_HOURS, so the
 * number the owner sees is what the next real run will actually do — that
 * equivalence is the whole point of the screen.
 */
export async function fetchHeldSummary(admin: Admin, locationId: string): Promise<HeldSummary> {
  const since = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("held_comms")
    .select("kind, summary, would_have_sent_at")
    .eq("location_id", locationId)
    .gte("last_seen_at", since)
    .order("would_have_sent_at", { ascending: true })
    .limit(5000);

  const rows = (data ?? []) as HeldRecord[];
  const byKind = new Map<HeldKind, HeldRecord[]>();
  for (const row of rows) {
    if (!(HELD_KINDS as readonly string[]).includes(row.kind)) continue;
    const kind = row.kind as HeldKind;
    byKind.set(kind, [...(byKind.get(kind) ?? []), row]);
  }

  const groups: HeldGroup[] = HELD_KINDS.filter((k) => byKind.has(k)).map((kind) => {
    const items = byKind.get(kind)!;
    return {
      kind,
      label: HELD_KIND_LABELS[kind],
      count: items.length,
      samples: items.slice(0, SAMPLE_LIMIT).map((i) => i.summary),
    };
  });

  return {
    total: rows.length,
    groups,
    oldestAt: rows[0]?.would_have_sent_at ?? null,
  };
}

/**
 * Drop a branch's holds — called when it goes live, because from that moment
 * the real crons own these sends and a leftover row would misreport the next
 * branch view.
 */
export async function clearHeld(admin: Admin, locationId: string): Promise<void> {
  const { error } = await admin.from("held_comms").delete().eq("location_id", locationId);
  if (error) console.error("[held-comms] clear failed", error.message);
}

/** Housekeeping: forget holds nothing has refreshed for a week. */
export async function pruneHeld(admin: Admin): Promise<number> {
  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("held_comms")
    .delete()
    .lt("last_seen_at", cutoff)
    .select("id");
  if (error) {
    console.error("[held-comms] prune failed", error.message);
    return 0;
  }
  return (data ?? []).length;
}
