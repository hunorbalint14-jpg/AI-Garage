import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { addCourtesyCar, setCourtesyCarActive, checkOutCourtesyCar, returnCourtesyCar } =
  await import("./actions");

beforeEach(() => vi.clearAllMocks());

const emptyForm = () => new FormData();

describe.each([
  ["addCourtesyCar", () => addCourtesyCar(emptyForm())],
  ["setCourtesyCarActive", () => setCourtesyCarActive("c1", false)],
  ["checkOutCourtesyCar", () => checkOutCourtesyCar(emptyForm())],
  ["returnCourtesyCar", () => returnCourtesyCar(emptyForm())],
])("%s denies without bookings perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
