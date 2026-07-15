import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/accounting/connection", () => ({
  getConnectionStatus: vi.fn(),
  deleteAccountingConnection: vi.fn(),
}));
vi.mock("@/lib/accounting/sync", () => ({
  pushInvoiceToAccounting: vi.fn(),
  pushPaymentToAccounting: vi.fn(),
  pushCreditNoteToAccounting: vi.fn(),
}));

const { requireStaffContext } = await import("@/lib/staff-context");
const { disconnectAccounting, retryAccountingSync } = await import("./accounting-actions");

beforeEach(() => vi.clearAllMocks());

describe("disconnectAccounting", () => {
  it("denies without xero_integration perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ xero_integration: false }));
    expect(await disconnectAccounting()).toEqual({ error: "Permission denied." });
  });
});

describe("retryAccountingSync", () => {
  it("denies without xero_integration perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ xero_integration: false }));
    expect(await retryAccountingSync()).toEqual({ error: "Permission denied." });
  });
});
