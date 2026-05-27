import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { saveQuoteValidityDays } = await import("./quote-validity-actions");

beforeEach(() => vi.clearAllMocks());

describe("saveQuoteValidityDays", () => {
  it("denies location user (org_settings is hard-locked)", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ org_settings: true }));
    expect(await saveQuoteValidityDays(new FormData())).toEqual({ error: "Permission denied." });
  });
});
