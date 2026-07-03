import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "u_ops", email: "ops@ai-garage.co.uk" } },
      })),
    },
  })),
}));
vi.mock("@/lib/platform-admin", () => ({ isPlatformAdminUser: vi.fn() }));
vi.mock("@/lib/doc-shares", () => ({
  createShare: vi.fn(),
  revokeShare: vi.fn(),
  shareUrl: vi.fn(() => "https://example.com/docs/test-slug?t=tok"),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

const { isPlatformAdminUser } = await import("@/lib/platform-admin");
const { createShare, revokeShare } = await import("@/lib/doc-shares");
const { logAudit } = await import("@/lib/audit");
const { createShareAction, revokeShareAction } = await import("./actions");

// Minimal DocShare stub returned by createShare.
const stubShare = {
  id: "share_1",
  organization_id: null,
  doc_key: "technical",
  slug: "test-slug",
  label: null,
  expires_at: null,
  max_views: null,
  view_count: 0,
  last_viewed_at: null,
  revoked_at: null,
  revoked_by: null,
  created_by: "u_ops",
  created_at: new Date().toISOString(),
};

beforeEach(() => vi.clearAllMocks());

// --- gate: non-platform-admins are bounced to /admin/login --------------

describe("createShareAction rejects non-platform-admin", () => {
  it("redirects to /admin/login and never mints", async () => {
    vi.mocked(isPlatformAdminUser).mockResolvedValue(false);

    const fd = new FormData();
    fd.set("doc_key", "technical");
    fd.set("expires_in_days", "7");

    await expect(createShareAction(fd)).rejects.toThrow("REDIRECT:/admin/login");
    expect(createShare).not.toHaveBeenCalled();
  });
});

describe("revokeShareAction rejects non-platform-admin", () => {
  it("redirects to /admin/login and never revokes", async () => {
    vi.mocked(isPlatformAdminUser).mockResolvedValue(false);

    await expect(revokeShareAction("share_1")).rejects.toThrow("REDIRECT:/admin/login");
    expect(revokeShare).not.toHaveBeenCalled();
  });
});

// --- platform admin passes the gate and actions succeed ------------------

describe("createShareAction allows platform admin", () => {
  it("returns ok:true and calls logAudit", async () => {
    vi.mocked(isPlatformAdminUser).mockResolvedValue(true);
    vi.mocked(createShare).mockResolvedValue({ share: stubShare, token: "tok" });

    const fd = new FormData();
    fd.set("doc_key", "technical");
    fd.set("expires_in_days", "7");

    const res = await createShareAction(fd);
    expect(res).toMatchObject({ ok: true, slug: "test-slug" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "doc_share.mint", entityId: "share_1" }),
    );
  });

  it("rejects an unknown doc key before minting", async () => {
    vi.mocked(isPlatformAdminUser).mockResolvedValue(true);

    const fd = new FormData();
    fd.set("doc_key", "not-a-doc");

    const res = await createShareAction(fd);
    expect(res).toEqual({ ok: false, error: "Unknown document." });
    expect(createShare).not.toHaveBeenCalled();
  });
});

describe("revokeShareAction allows platform admin", () => {
  it("returns ok:true and calls logAudit", async () => {
    vi.mocked(isPlatformAdminUser).mockResolvedValue(true);
    vi.mocked(revokeShare).mockResolvedValue(undefined);

    const res = await revokeShareAction("share_1");
    expect(res).toEqual({ ok: true });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "doc_share.revoke", entityId: "share_1" }),
    );
  });
});
