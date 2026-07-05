import { describe, it, expect, vi, beforeEach } from "vitest";

const isAdmin = { value: true };
vi.mock("@/lib/platform-admin", () => ({
  requirePlatformAdmin: vi.fn(async () => {
    if (!isAdmin.value) throw new Error("REDIRECT:/admin/login");
    return { id: "u_ops", email: "ops@ai-garage.co.uk" };
  }),
}));

const getAdminTicket = vi.fn();
const addAdminMessage = vi.fn();
const setTicketStatus = vi.fn();
const setTicketPriority = vi.fn();
vi.mock("@/lib/support-tickets", async () => {
  const shared = await vi.importActual<typeof import("@/lib/support-tickets-shared")>(
    "@/lib/support-tickets-shared",
  );
  return {
    ...shared,
    getAdminTicket: (...a: unknown[]) => getAdminTicket(...a),
    addAdminMessage: (...a: unknown[]) => addAdminMessage(...a),
    setTicketStatus: (...a: unknown[]) => setTicketStatus(...a),
    setTicketPriority: (...a: unknown[]) => setTicketPriority(...a),
  };
});

const sendAdminReplyEmailToRequester = vi.fn();
const sendStatusChangeEmailToRequester = vi.fn();
vi.mock("@/lib/support-ticket-emails", () => ({
  sendAdminReplyEmailToRequester: (...a: unknown[]) => sendAdminReplyEmailToRequester(...a),
  sendStatusChangeEmailToRequester: (...a: unknown[]) => sendStatusChangeEmailToRequester(...a),
}));

const createStaffNotification = vi.fn();
vi.mock("@/lib/staff-notifications", () => ({
  createStaffNotification: (...a: unknown[]) => createStaffNotification(...a),
}));

const logAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

import { adminReplyAction, adminSetStatusAction, adminSetPriorityAction } from "./actions";

const TICKET = {
  id: "t-1",
  organization_id: "org-1",
  location_id: "loc-1",
  created_by: "user-1",
  requester_email: "mech@garage.co.uk",
  type: "bug",
  status: "open",
  priority: "p3",
  subject: "Broken thing",
  first_response_at: null,
  org: { name: "Smith Motors", slug: "smith-motors" },
};

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  isAdmin.value = true;
  getAdminTicket.mockResolvedValue({ ...TICKET });
  addAdminMessage.mockResolvedValue({ message: { id: "m-1" } });
  setTicketStatus.mockResolvedValue({ ok: true });
  setTicketPriority.mockResolvedValue({ ok: true });
});

describe("gate", () => {
  it("non-admin never writes", async () => {
    isAdmin.value = false;
    await expect(adminReplyAction("t-1", form({ body: "hi" }))).rejects.toThrow("REDIRECT:/admin/login");
    expect(addAdminMessage).not.toHaveBeenCalled();
  });
});

describe("adminReplyAction", () => {
  it("public reply emails the requester and pings the bell", async () => {
    const res = await adminReplyAction("t-1", form({ body: "On it." }));
    expect(res).toEqual({ ok: true });
    expect(sendAdminReplyEmailToRequester).toHaveBeenCalledOnce();
    expect(createStaffNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ticket.reply", userId: "user-1", locationId: "loc-1" }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ticket.reply", organizationId: "org-1" }),
    );
  });

  it("internal note: NO email, NO notification, org-less audit", async () => {
    const res = await adminReplyAction("t-1", form({ body: "free tier, deprioritise", internal: "on" }));
    expect(res).toEqual({ ok: true });
    expect(sendAdminReplyEmailToRequester).not.toHaveBeenCalled();
    expect(createStaffNotification).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ticket.internal_note", organizationId: null }),
    );
  });

  it("reply + status in one submit sends ONE combined email", async () => {
    const res = await adminReplyAction("t-1", form({ body: "Fixed.", status: "resolved" }));
    expect(res).toEqual({ ok: true });
    expect(setTicketStatus).toHaveBeenCalledWith(expect.anything(), "resolved");
    expect(sendAdminReplyEmailToRequester).toHaveBeenCalledWith(
      expect.anything(),
      "smith-motors",
      "Fixed.",
      expect.objectContaining({ newStatus: "resolved" }),
    );
    expect(sendStatusChangeEmailToRequester).not.toHaveBeenCalled();
  });

  it("rejects an invalid transition for the type", async () => {
    const res = await adminReplyAction("t-1", form({ body: "x", status: "planned" }));
    expect("error" in res).toBe(true);
    expect(addAdminMessage).not.toHaveBeenCalled();
  });

  it("skips the bell when the raise-time branch is gone", async () => {
    getAdminTicket.mockResolvedValue({ ...TICKET, location_id: null });
    await adminReplyAction("t-1", form({ body: "hi" }));
    expect(createStaffNotification).not.toHaveBeenCalled();
    expect(sendAdminReplyEmailToRequester).toHaveBeenCalledOnce(); // email still goes
  });

  it("skips the bell when the requesting user is deleted", async () => {
    getAdminTicket.mockResolvedValue({ ...TICKET, created_by: null });
    await adminReplyAction("t-1", form({ body: "hi" }));
    expect(createStaffNotification).not.toHaveBeenCalled();
    expect(sendAdminReplyEmailToRequester).toHaveBeenCalledOnce();
  });
});

describe("adminSetStatusAction", () => {
  it("valid transition fans out", async () => {
    const res = await adminSetStatusAction("t-1", "in_progress");
    expect(res).toEqual({ ok: true });
    expect(sendStatusChangeEmailToRequester).toHaveBeenCalledOnce();
    expect(createStaffNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ticket.status" }),
    );
  });

  it("rejects planned on a bug", async () => {
    const res = await adminSetStatusAction("t-1", "planned");
    expect("error" in res).toBe(true);
    expect(setTicketStatus).not.toHaveBeenCalled();
  });
});

describe("adminSetPriorityAction", () => {
  it("audits without any fan-out", async () => {
    const res = await adminSetPriorityAction("t-1", "p1");
    expect(res).toEqual({ ok: true });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.priority_change" }));
    expect(sendStatusChangeEmailToRequester).not.toHaveBeenCalled();
    expect(createStaffNotification).not.toHaveBeenCalled();
  });
});
