import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { incidentRef, opsRecipients } from "./alerts";

const ORIGINAL = {
  support: process.env.PLATFORM_SUPPORT_EMAIL,
  admins: process.env.PLATFORM_ADMIN_EMAILS,
  slack: process.env.SLACK_OPS_WEBHOOK_URL,
};

describe("opsRecipients", () => {
  beforeEach(() => {
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    delete process.env.PLATFORM_ADMIN_EMAILS;
  });

  afterEach(() => {
    process.env.PLATFORM_SUPPORT_EMAIL = ORIGINAL.support;
    process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL.admins;
    process.env.SLACK_OPS_WEBHOOK_URL = ORIGINAL.slack;
  });

  it("is empty when nothing is configured — the state that means alerts reach nobody", () => {
    expect(opsRecipients()).toEqual([]);
  });

  it("combines the support inbox and the admin allowlist", () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "ops@example.test";
    process.env.PLATFORM_ADMIN_EMAILS = "ada@example.test, grace@example.test";
    expect(opsRecipients()).toEqual(["ops@example.test", "ada@example.test", "grace@example.test"]);
  });

  it("dedupes case-insensitively so one person gets one email", () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "Ops@Example.test";
    process.env.PLATFORM_ADMIN_EMAILS = "ops@example.test";
    expect(opsRecipients()).toEqual(["ops@example.test"]);
  });

  it("ignores junk entries rather than emailing them", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "not-an-email, , ops@example.test";
    expect(opsRecipients()).toEqual(["ops@example.test"]);
  });
});

describe("incidentRef", () => {
  it("doesn't repeat inside one evaluation run", () => {
    // incidents.ref is UNIQUE: two rules firing on the same millisecond used to
    // collide, and the second incident was silently dropped.
    const now = Date.now();
    const refs = new Set(Array.from({ length: 200 }, () => incidentRef(now)));
    expect(refs.size).toBeGreaterThan(190);
  });

  it("stays readable", () => {
    expect(incidentRef(1_753_459_200_000)).toMatch(/^INC-\d{5}-[A-Z0-9]{3}$/);
  });
});

describe("deliverAlert", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PLATFORM_SUPPORT_EMAIL;
    delete process.env.PLATFORM_ADMIN_EMAILS;
    delete process.env.SLACK_OPS_WEBHOOK_URL;
  });

  afterEach(() => {
    process.env.PLATFORM_SUPPORT_EMAIL = ORIGINAL.support;
    process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL.admins;
    process.env.SLACK_OPS_WEBHOOK_URL = ORIGINAL.slack;
    vi.restoreAllMocks();
  });

  async function load(sendEmailBatch: ReturnType<typeof vi.fn>) {
    vi.doMock("@/lib/email", () => ({ sendEmailBatch }));
    return await import("./alerts");
  }

  it("emails when Slack isn't configured, even though the rule only names Slack", async () => {
    process.env.PLATFORM_SUPPORT_EMAIL = "ops@example.test";
    const sendEmailBatch = vi.fn().mockResolvedValue([{ success: true }]);
    const { deliverAlert } = await load(sendEmailBatch);

    const res = await deliverAlert({ subject: "s", text: "t", channels: ["Slack #ops"] });

    expect(res).toMatchObject({ slack: false, email: true, delivered: true });
    expect(sendEmailBatch).toHaveBeenCalledOnce();
  });

  it("reports delivered:false and logs loudly when nothing is configured", async () => {
    const sendEmailBatch = vi.fn();
    const { deliverAlert } = await load(sendEmailBatch);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await deliverAlert({ subject: "s", text: "t", channels: ["Slack #ops"] });

    expect(res.delivered).toBe(false);
    expect(sendEmailBatch).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("[alerts] NOT DELIVERED — no ops channel is configured", expect.anything());
    spy.mockRestore();
  });

  it("skips the email fallback once Slack has taken it", async () => {
    process.env.SLACK_OPS_WEBHOOK_URL = "https://hooks.example.test/x";
    process.env.PLATFORM_SUPPORT_EMAIL = "ops@example.test";
    const sendEmailBatch = vi.fn().mockResolvedValue([{ success: true }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { deliverAlert } = await load(sendEmailBatch);

    const res = await deliverAlert({ subject: "s", text: "t", channels: ["Slack #ops"] });

    expect(res).toMatchObject({ slack: true, email: false, delivered: true });
    expect(sendEmailBatch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("still emails when the rule asks for both", async () => {
    process.env.SLACK_OPS_WEBHOOK_URL = "https://hooks.example.test/x";
    process.env.PLATFORM_SUPPORT_EMAIL = "ops@example.test";
    const sendEmailBatch = vi.fn().mockResolvedValue([{ success: true }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const { deliverAlert } = await load(sendEmailBatch);

    const res = await deliverAlert({ subject: "s", text: "t", channels: ["Slack #ops", "Email ops"] });

    expect(res).toMatchObject({ slack: true, email: true, delivered: true });
    vi.unstubAllGlobals();
  });

  it("falls back to email when the Slack webhook errors", async () => {
    process.env.SLACK_OPS_WEBHOOK_URL = "https://hooks.example.test/x";
    process.env.PLATFORM_SUPPORT_EMAIL = "ops@example.test";
    const sendEmailBatch = vi.fn().mockResolvedValue([{ success: true }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deliverAlert } = await load(sendEmailBatch);

    const res = await deliverAlert({ subject: "s", text: "t", channels: ["Slack #ops"] });

    expect(res).toMatchObject({ slack: false, email: true, delivered: true });
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});
