import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/platform-admin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ id: "u_ops", email: "ops@ai-garage.co.uk" })),
}));
const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

// Per-table fakes: `incidents` reads return the canned incident and record
// updates; `incident_updates` inserts return the canned insert result.
type Result = { data?: unknown; error?: { message: string } | null };
const state = {
  incident: { data: { id: "inc-1", published: false }, error: null } as Result,
  insert: { error: null } as Result,
  update: { error: null } as Result,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
};
function incidentsTable() {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => state.incident;
  chain.update = (patch: Record<string, unknown>) => {
    state.updates.push(patch);
    return { eq: async () => state.update };
  };
  return chain;
}
function updatesTable() {
  return {
    insert: async (row: Record<string, unknown>) => {
      state.inserts.push(row);
      return state.insert;
    },
  };
}
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => (table === "incidents" ? incidentsTable() : updatesTable()),
  }),
}));

import { addIncidentUpdate, setIncidentPublished } from "./incident-actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.incident = { data: { id: "inc-1", published: false }, error: null };
  state.insert = { error: null };
  state.update = { error: null };
  state.updates = [];
  state.inserts = [];
  logAudit.mockClear();
  revalidatePath.mockClear();
});

describe("addIncidentUpdate", () => {
  it("publishes an unpublished incident when the update is public", async () => {
    const r = await addIncidentUpdate(form({ incidentId: "inc-1", status: "Identified", body: "Cause found", public: "on" }));
    expect(r).toEqual({ success: true });
    expect(state.inserts[0]).toMatchObject({ incident_id: "inc-1", public: true });
    expect(state.updates[0]).toEqual({ status: "Identified", published: true });
    expect(logAudit.mock.calls[0][0].metadata).toMatchObject({ public: true, published: true });
  });

  it("leaves publication alone for an internal update", async () => {
    await addIncidentUpdate(form({ incidentId: "inc-1", status: "Investigating", body: "Looking" }));
    expect(state.inserts[0]).toMatchObject({ public: false });
    expect(state.updates[0]).toEqual({ status: "Investigating" });
  });

  it("doesn't re-publish an already published incident", async () => {
    state.incident = { data: { id: "inc-1", published: true }, error: null };
    await addIncidentUpdate(form({ incidentId: "inc-1", status: "Monitoring", body: "Fix out", public: "on" }));
    expect(state.updates[0]).toEqual({ status: "Monitoring" });
  });

  it("stamps resolved_at when resolving", async () => {
    await addIncidentUpdate(form({ incidentId: "inc-1", status: "Resolved", body: "Resolved.", public: "on" }));
    expect(state.updates[0]).toMatchObject({ status: "Resolved", published: true });
    expect(typeof state.updates[0].resolved_at).toBe("string");
  });

  it("reports a failed insert instead of claiming success, and leaves the incident untouched", async () => {
    state.insert = { error: { message: "boom" } };
    const r = await addIncidentUpdate(form({ incidentId: "inc-1", status: "Identified", body: "x", public: "on" }));
    expect(r).toEqual({ error: "The update didn't save: boom" });
    expect(state.updates).toHaveLength(0);
  });

  it("reports a failed status change", async () => {
    state.update = { error: { message: "nope" } };
    const r = await addIncidentUpdate(form({ incidentId: "inc-1", status: "Identified", body: "x" }));
    expect(r).toEqual({ error: "The update was saved, but the incident status didn't change: nope" });
  });

  it("rejects an unknown incident", async () => {
    state.incident = { data: null, error: null };
    const r = await addIncidentUpdate(form({ incidentId: "missing", status: "Identified", body: "x" }));
    expect(r).toEqual({ error: "Incident not found." });
    expect(state.inserts).toHaveLength(0);
  });

  it("revalidates the incidents page and the public status page", async () => {
    await addIncidentUpdate(form({ incidentId: "inc-1", status: "Identified", body: "x" }));
    expect(revalidatePath).toHaveBeenCalledWith("/admin/incidents");
    expect(revalidatePath).toHaveBeenCalledWith("/status");
  });
});

describe("setIncidentPublished", () => {
  it("surfaces a failed update", async () => {
    state.update = { error: { message: "denied" } };
    expect(await setIncidentPublished("inc-1", true)).toEqual({ error: "denied" });
    expect(logAudit).not.toHaveBeenCalled();
  });
});
