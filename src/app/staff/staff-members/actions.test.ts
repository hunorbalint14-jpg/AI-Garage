import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContext, mockStaffContextMember } from "@/test/helpers/staff-context-mock";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("@/lib/staff-context", () => ({
  requireStaffContext: vi.fn(),
  invalidateStaffMembershipCache: vi.fn(),
  invalidateStaffMembershipCacheForOrg: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createAdminClient } = await import("@/lib/supabase/admin");
const { logAudit } = await import("@/lib/audit");
const {
  inviteStaffMember,
  resetStaffPassword,
  setStaffPassword,
  resetStaffMfa,
  updateStaffPermissions,
  updateStaffRole,
  updateStaffMotFlags,
  removeStaffMember,
} = await import("./actions");

beforeEach(() => vi.clearAllMocks());

// All staff-members actions are owner/admin only (orgRole gate). A plain
// location user (no orgRole) should be rejected with the owner-only message.
describe.each([
  ["inviteStaffMember", () => inviteStaffMember(new FormData())],
  ["resetStaffPassword", () => resetStaffPassword("a@b.test")],
  ["setStaffPassword", () => setStaffPassword("u_1", "password123")],
  ["resetStaffMfa", () => resetStaffMfa("u_1")],
  ["updateStaffPermissions", () =>
    updateStaffPermissions("u_1", "l_1", {} as never)],
  ["updateStaffRole", () => updateStaffRole("u_1", "l_1", "mechanic")],
  ["updateStaffMotFlags", () => updateStaffMotFlags("u_1", "l_1", false, false)],
  ["removeStaffMember", () => removeStaffMember("u_1", "l_1")],
])("%s rejects non-org user", (_name, run) => {
  it("returns owner/admin only error", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({}));
    const res = await run();
    expect(res).toEqual({ error: "Owner or admin only." });
  });
});

// #133 — staff.remove must record the removed member's identity in the audit
// metadata before the membership row is deleted.
describe("removeStaffMember audit identity", () => {
  it("captures removed_email + removed_name from getUserById", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContext({ orgRole: "owner" }));
    const admin = createSupabaseMock({ error: null });
    admin.auth.admin.getUserById = vi.fn().mockResolvedValue({
      data: { user: { email: "removed@garage.test", user_metadata: { full_name: "Removed Person" } } },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await removeStaffMember("u_target", "l_1");
    expect(res).toEqual({ success: true });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.remove",
        entityId: "u_target",
        metadata: expect.objectContaining({
          location_id: "l_1",
          removed_email: "removed@garage.test",
          removed_name: "Removed Person",
        }),
      }),
    );
  });

  it("degrades gracefully when the user lookup returns nothing", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContext({ orgRole: "owner" }));
    const admin = createSupabaseMock({ error: null });
    admin.auth.admin.getUserById = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await removeStaffMember("u_target", null);
    expect(res).toEqual({ success: true });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "staff.remove",
        metadata: expect.objectContaining({ removed_email: null, removed_name: null }),
      }),
    );
  });
});
