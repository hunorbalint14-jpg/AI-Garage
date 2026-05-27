import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createBay, deleteBay, updateBay } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["createBay", () => createBay(new FormData())],
  ["deleteBay", () => deleteBay("b_1")],
  ["updateBay", () => updateBay("b_1", new FormData())],
])("%s denies without bays perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bays: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
