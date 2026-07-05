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

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest-agent" }),
}));

import { createSupportTicketAction, replyToTicketAction } from "./actions";

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

  it("creates, audits and redirects on the happy path", async () => {
    createTicket.mockResolvedValue({ ticket: { id: "t-1", subject: "abc" } });
    await expect(
      createSupportTicketAction(form({ type: "bug", subject: "Broken widget", body: "It broke." })),
    ).rejects.toThrow("REDIRECT:/staff/support/t-1");
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
