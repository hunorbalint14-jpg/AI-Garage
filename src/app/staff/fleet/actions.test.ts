import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createFleetCompany, updateFleetCompany, deleteFleetCompany, assignCustomerToFleet } =
  await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["createFleetCompany", () => createFleetCompany(new FormData())],
  ["updateFleetCompany", () => updateFleetCompany("f_1", new FormData())],
  ["deleteFleetCompany", () => deleteFleetCompany("f_1")],
  ["assignCustomerToFleet", () => assignCustomerToFleet("c_1", null)],
])("%s denies without fleet perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ fleet: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
