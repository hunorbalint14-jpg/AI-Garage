import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createRoleTemplate, updateRoleTemplate, deleteRoleTemplate, cloneRoleTemplate } =
  await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["createRoleTemplate", () => createRoleTemplate(new FormData())],
  ["updateRoleTemplate", () => updateRoleTemplate("t_1", new FormData())],
  ["deleteRoleTemplate", () => deleteRoleTemplate("t_1")],
  ["cloneRoleTemplate", () => cloneRoleTemplate("t_1", "label")],
])("%s rejects non-org user", (_name, run) => {
  it("returns owner-only error", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({}));
    const res = await run();
    expect(res).toEqual({ ok: false, error: "Owner or admin only." });
  });
});
