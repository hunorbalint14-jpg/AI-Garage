import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
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
