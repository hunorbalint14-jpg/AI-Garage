import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { updateConsent, anonymizeCustomer, exportCustomerData } = await import("./gdpr-actions");

beforeEach(() => vi.clearAllMocks());

describe("updateConsent", () => {
  it("denies without customers perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ customers: false }));
    const res = await updateConsent("c_1", true, true);
    expect(res).toEqual({ error: "Permission denied." });
  });
});

describe("anonymizeCustomer", () => {
  it("denies location user (gdpr_actions is hard-locked)", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ gdpr_actions: true }));
    const res = await anonymizeCustomer("c_1", "reason");
    expect(res).toEqual({ error: "Only owners/admins can erase customer data." });
  });
});

describe("exportCustomerData", () => {
  it("denies location user (gdpr_actions is hard-locked)", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ gdpr_actions: true }));
    const res = await exportCustomerData("c_1");
    expect(res).toEqual({ error: "Permission denied." });
  });
});
