import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { upsertService, toggleServiceActive, deleteService } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["upsertService", () => upsertService(new FormData())],
  ["toggleServiceActive", () => toggleServiceActive("s_1", true)],
  ["deleteService", () => deleteService("s_1")],
])("%s denies without services perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ services: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
