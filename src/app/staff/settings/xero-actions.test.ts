import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { disconnectXero } = await import("./xero-actions");

beforeEach(() => vi.clearAllMocks());

describe("disconnectXero", () => {
  it("denies without xero_integration perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ xero_integration: false }));
    expect(await disconnectXero()).toEqual({ error: "Permission denied." });
  });
});
