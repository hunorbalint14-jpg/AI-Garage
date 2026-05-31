import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContext, mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/doc-shares", () => ({
  createShare: vi.fn(),
  revokeShare: vi.fn(),
  shareUrl: vi.fn(() => "https://example.com/docs/test-slug?token=tok"),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(() => ({ get: vi.fn(() => null) })),
}));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createShare, revokeShare } = await import("@/lib/doc-shares");
const { logAudit } = await import("@/lib/audit");
const { createShareAction, revokeShareAction } = await import("./actions");

// Minimal DocShare stub returned by createShare.
const stubShare = {
  id: "share_1",
  organization_id: "o_test",
  doc_key: "technical",
  slug: "test-slug",
  token_hash: "hashed",
  label: null,
  expires_at: null,
  max_views: null,
  view_count: 0,
  last_viewed_at: null,
  revoked_at: null,
  revoked_by: null,
  created_by: "u_test",
  created_at: new Date().toISOString(),
};

beforeEach(() => vi.clearAllMocks());

// --- role gate: non-org (location-only) users must be rejected ----------

describe("createShareAction rejects non-org user", () => {
  it("returns an error for a location-only staff member", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({}));

    const fd = new FormData();
    fd.set("doc_key", "technical");
    fd.set("expires_in_days", "7");

    const res = await createShareAction(fd);
    expect(res).toEqual({ ok: false, error: "Only owners or admins can mint share links." });
    expect(createShare).not.toHaveBeenCalled();
  });
});

describe("revokeShareAction rejects non-org user", () => {
  it("returns an error for a location-only staff member", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({}));

    const res = await revokeShareAction("share_1");
    expect(res).toEqual({ ok: false, error: "Only owners or admins can revoke share links." });
    expect(revokeShare).not.toHaveBeenCalled();
  });
});

// --- admin passes the gate and actions succeed -------------------------

describe("createShareAction allows admin", () => {
  it("returns ok:true and calls logAudit", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(
      mockStaffContext({ orgRole: "admin" }),
    );
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
});

describe("revokeShareAction allows admin", () => {
  it("returns ok:true and calls logAudit", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(
      mockStaffContext({ orgRole: "admin" }),
    );
    vi.mocked(revokeShare).mockResolvedValue(undefined);

    const res = await revokeShareAction("share_1");
    expect(res).toEqual({ ok: true });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "doc_share.revoke", entityId: "share_1" }),
    );
  });
});

// --- owner regression guard: owners must still pass --------------------

describe("createShareAction allows owner", () => {
  it("returns ok:true for orgRole owner", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(
      mockStaffContext({ orgRole: "owner" }),
    );
    vi.mocked(createShare).mockResolvedValue({ share: stubShare, token: "tok" });

    const fd = new FormData();
    fd.set("doc_key", "technical");
    fd.set("expires_in_days", "7");

    const res = await createShareAction(fd);
    expect(res).toMatchObject({ ok: true });
  });
});

describe("revokeShareAction allows owner", () => {
  it("returns ok:true for orgRole owner", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(
      mockStaffContext({ orgRole: "owner" }),
    );
    vi.mocked(revokeShare).mockResolvedValue(undefined);

    const res = await revokeShareAction("share_1");
    expect(res).toEqual({ ok: true });
  });
});
