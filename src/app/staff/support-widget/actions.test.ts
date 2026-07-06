import { describe, it, expect, vi, beforeEach } from "vitest";

const requireStaffContext = vi.fn();
vi.mock("@/lib/staff-context", () => ({ requireStaffContext: (...a: unknown[]) => requireStaffContext(...a) }));

const enforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) };
});

const createTicket = vi.fn();
const getOrgTicket = vi.fn();
const addStaffReply = vi.fn();
vi.mock("@/lib/support-tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/support-tickets")>();
  return {
    ...actual,
    createTicket: (...a: unknown[]) => createTicket(...a),
    getOrgTicket: (...a: unknown[]) => getOrgTicket(...a),
    addStaffReply: (...a: unknown[]) => addStaffReply(...a),
  };
});

const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));

vi.mock("@/lib/support-ticket-emails", () => ({
  sendNewTicketEmailToPlatform: vi.fn(),
  sendStaffReplyEmailToPlatform: vi.fn(),
}));

const shotObjectExists = vi.fn();
vi.mock("@/lib/support-shots", () => ({
  shotObjectExists: (...a: unknown[]) => shotObjectExists(...a),
  shotPath: vi.fn(() => "org-1/00000000-0000-0000-0000-000000000000.png"),
  createShotUploadUrl: vi.fn(),
}));

const notifUpdate = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const builder = {
        update: (...a: unknown[]) => {
          notifUpdate(...a);
          return builder;
        },
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        not: () => builder,
        then: (resolve: (v: { data: { id: string }[] }) => void) =>
          resolve({ data: [{ id: "n-1" }] }),
      };
      return builder;
    },
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest-agent" }),
}));

import {
  createSupportTicketAction,
  replyToTicketAction,
  markTicketNotificationsReadAction,
} from "./actions";

const CTX = {
  organization: { id: "org-1", name: "Smith Motors", slug: "smith-motors" },
  location: { id: "loc-1", name: "Smith Motors" },
  orgRole: null,
  locationRole: "mechanic",
  user: { id: "user-1", email: "mech@x.com", fullName: "Mike Spanner" },
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaffContext.mockResolvedValue(CTX);
  enforceRateLimit.mockResolvedValue({ ok: true });
});

describe("createSupportTicketAction", () => {
  it("rejects an unknown type without inserting", async () => {
    const res = await createSupportTicketAction(form({ type: "rant", subject: "abc", body: "x" }));
    expect(res).toEqual({ error: "Pick a ticket type." });
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("rejects a too-short subject", async () => {
    const res = await createSupportTicketAction(form({ type: "bug", subject: "ab", body: "x" }));
    expect("error" in res!).toBe(true);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("stops at the rate limit without inserting", async () => {
    enforceRateLimit.mockResolvedValue({ ok: false, retryAfter: 120 });
    const res = await createSupportTicketAction(form({ type: "bug", subject: "abc", body: "x" }));
    expect("error" in res!).toBe(true);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("creates, audits and returns the ref on the happy path (no redirect)", async () => {
    createTicket.mockResolvedValue({ ticket: { id: "3f2a9c1b-1234-5678-9abc-def012345678", subject: "abc" } });
    const res = await createSupportTicketAction(
      form({ type: "bug", subject: "Broken widget", body: "It broke." }),
    );
    expect(res).toEqual({
      ok: true,
      ticketId: "3f2a9c1b-1234-5678-9abc-def012345678",
      ref: "#3F2A9C1B",
    });
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        createdBy: "user-1",
        type: "bug",
        subject: "Broken widget",
        context: expect.objectContaining({ user_agent: "vitest-agent", org_slug: "smith-motors" }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.create" }));
  });

  it("drops a screenshot path outside this org's folder", async () => {
    createTicket.mockResolvedValue({ ticket: { id: "t-1", subject: "abc" } });
    shotObjectExists.mockResolvedValue(true);
    await createSupportTicketAction(
      form({
        type: "bug",
        subject: "Broken widget",
        body: "x",
        screenshot_path: "org-EVIL/00000000-0000-0000-0000-000000000000.png",
      }),
    );
    expect(shotObjectExists).not.toHaveBeenCalled();
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ screenshot_path: null }) }),
    );
  });

  it("keeps a valid, existing screenshot path", async () => {
    createTicket.mockResolvedValue({ ticket: { id: "t-1", subject: "abc" } });
    shotObjectExists.mockResolvedValue(true);
    const path = "org-1/00000000-0000-0000-0000-000000000000.png";
    await createSupportTicketAction(
      form({ type: "bug", subject: "Broken widget", body: "x", screenshot_path: path }),
    );
    expect(shotObjectExists).toHaveBeenCalledWith(path);
    expect(createTicket).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ screenshot_path: path }) }),
    );
  });
});

describe("markTicketNotificationsReadAction", () => {
  it("clears own notifications and reports the count", async () => {
    const res = await markTicketNotificationsReadAction("t-1");
    expect(res).toEqual({ cleared: 1 });
    expect(notifUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) }),
    );
  });
});

describe("replyToTicketAction", () => {
  it("rejects when the ticket is not in this org", async () => {
    getOrgTicket.mockResolvedValue(null);
    const res = await replyToTicketAction("t-x", form({ body: "hello" }));
    expect(res).toEqual({ error: "Ticket not found." });
    expect(addStaffReply).not.toHaveBeenCalled();
  });

  it.each(["closed", "declined"] as const)("rejects replies on %s tickets", async (status) => {
    getOrgTicket.mockResolvedValue({ id: "t-1", status, organization_id: "org-1" });
    const res = await replyToTicketAction("t-1", form({ body: "hello" }));
    expect("error" in res).toBe(true);
    expect(addStaffReply).not.toHaveBeenCalled();
  });

  it("replies and audits on an open ticket", async () => {
    getOrgTicket.mockResolvedValue({ id: "t-1", status: "open", organization_id: "org-1" });
    addStaffReply.mockResolvedValue({ message: { id: "m-1" }, newStatus: null });
    const res = await replyToTicketAction("t-1", form({ body: "hello" }));
    expect(res).toEqual({ ok: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.reply" }));
  });
});
