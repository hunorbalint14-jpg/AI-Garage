import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  sendEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/lib/activation-emails", () => ({
  ownerContact: vi.fn(async () => ({ email: "owner@example.com", first: "Sam" })),
}));

const { sendEmail } = await import("@/lib/email");
import type { TrialOrg } from "./trial-ending-emails";
const { trialNoticeDue, trialEndingEmail, runTrialEndingSweep } = await import("./trial-ending-emails");

const NOW = new Date("2027-01-10T09:00:00Z");
const END = "2027-01-17T09:00:00+00:00"; // PostgREST format: exactly 7 days out

const org = (over: Partial<TrialOrg> = {}): TrialOrg => ({
  id: "org_1",
  slug: "smith-motors",
  name: "Smith Motors",
  tenant_plan: "growth",
  tenant_subscription_status: null,
  tenant_trial_end: END,
  tenant_trial_notice_for: null,
  ...over,
});

describe("trialNoticeDue", () => {
  it("is due inside the last 7 days of a courtesy trial", () => {
    expect(trialNoticeDue(org(), NOW)).toBe(true);
    expect(trialNoticeDue(org(), new Date("2027-01-17T08:00:00Z"))).toBe(true); // a late send is fine
  });

  it("is not due before the window or after the trial ends", () => {
    expect(trialNoticeDue(org(), new Date("2027-01-10T08:59:00Z"))).toBe(false);
    expect(trialNoticeDue(org(), new Date("2027-01-17T09:00:00Z"))).toBe(false);
  });

  it("sends once per trial — the marker matches whatever offset format it was stored in", () => {
    expect(trialNoticeDue(org({ tenant_trial_notice_for: "2027-01-17T09:00:00.000Z" }), NOW)).toBe(false);
    expect(trialNoticeDue(org({ tenant_trial_notice_for: END }), NOW)).toBe(false);
  });

  it("is due again for a re-granted trial (new end date)", () => {
    expect(trialNoticeDue(org({ tenant_trial_notice_for: "2026-11-17T09:00:00+00:00" }), NOW)).toBe(true);
  });

  it("skips Starter and orgs Stripe bills (incl. a carried-over trialing sub)", () => {
    expect(trialNoticeDue(org({ tenant_plan: "starter" }), NOW)).toBe(false);
    for (const s of ["trialing", "active", "past_due"]) {
      expect(trialNoticeDue(org({ tenant_subscription_status: s }), NOW)).toBe(false);
    }
    expect(trialNoticeDue(org({ tenant_subscription_status: "canceled" }), NOW)).toBe(true);
  });
});

describe("trialEndingEmail", () => {
  it("names the tier and end date, links billing, and quotes no prices", () => {
    const e = trialEndingEmail({ slug: "smith-motors", name: "Smith Motors", tier: "growth", trialEnd: END }, "Sam");
    expect(e.subject).toBe("Your Growth trial ends on Sunday, 17 January 2027");
    for (const body of [e.html, e.text]) {
      expect(body).toContain("Growth");
      expect(body).toContain("17 January 2027");
      expect(body).toContain("https://smith-motors.");
      expect(body).toContain("/staff/settings/billing");
      expect(body).toContain("The AI receptionist");
      expect(body).not.toContain("£");
    }
    expect(e.text).not.toMatch(/\d%/); // fee rates are prices too (html has CSS widths)
  });

  it("lists only the features the tier adds over Starter", () => {
    const e = trialEndingEmail({ slug: "s", name: "S", tier: "pro", trialEnd: END }, "Sam");
    expect(e.subject).toContain("Pro trial");
    expect(e.text).toContain("Marketing campaigns");
    expect(e.text).not.toContain("receptionist");
  });
});

// organizations.select(...).in().gt().lte().limit() → rows;
// organizations.update(...).eq()[.eq()|.is()][.select()] → claimed rows.
function fakeAdmin(rows: TrialOrg[], claimed: { id: string }[] = [{ id: "org_1" }]) {
  const updates: { patch: Record<string, unknown>; filters: unknown[][] }[] = [];
  const admin = {
    from: () => ({
      select: () => {
        const q = { in: () => q, gt: () => q, lte: () => q, limit: async () => ({ data: rows, error: null }) };
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        const u = { patch, filters: [] as unknown[][] };
        updates.push(u);
        const q = {
          eq: (...a: unknown[]) => (u.filters.push(["eq", ...a]), q),
          is: (...a: unknown[]) => (u.filters.push(["is", ...a]), q),
          select: async () => ({ data: claimed, error: null }),
          then: (res: (v: unknown) => void) => res({ error: null }),
        };
        return q;
      },
    }),
  };
  return { admin: admin as never, updates };
}

describe("runTrialEndingSweep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims the trial end, then emails the owner", async () => {
    const { admin, updates } = fakeAdmin([org()]);
    const r = await runTrialEndingSweep(admin, NOW);
    expect(r).toMatchObject({ checked: 1, sent: 1, errors: [] });
    expect(updates[0].patch).toEqual({ tenant_trial_notice_for: END });
    expect(updates[0].filters).toContainEqual(["is", "tenant_trial_notice_for", null]);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner@example.com", subject: expect.stringContaining("Growth trial") }),
    );
  });

  it("guards a re-grant claim on the previous marker", async () => {
    const prev = "2026-11-17T09:00:00+00:00";
    const { admin, updates } = fakeAdmin([org({ tenant_trial_notice_for: prev })]);
    await runTrialEndingSweep(admin, NOW);
    expect(updates[0].filters).toContainEqual(["eq", "tenant_trial_notice_for", prev]);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("does not send when another run already claimed it", async () => {
    const { admin } = fakeAdmin([org()], []);
    const r = await runTrialEndingSweep(admin, NOW);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips already-notified trials without writing", async () => {
    const { admin, updates } = fakeAdmin([org({ tenant_trial_notice_for: END })]);
    const r = await runTrialEndingSweep(admin, NOW);
    expect(r).toMatchObject({ sent: 0, skipped: 1 });
    expect(updates).toHaveLength(0);
  });

  it("releases the claim when the send fails, so tomorrow retries", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: "resend down" } as never);
    const { admin, updates } = fakeAdmin([org()]);
    const r = await runTrialEndingSweep(admin, NOW);
    expect(r.errors).toEqual(["smith-motors: resend down"]);
    expect(updates.map((u) => u.patch)).toEqual([{ tenant_trial_notice_for: END }, { tenant_trial_notice_for: null }]);
  });
});
