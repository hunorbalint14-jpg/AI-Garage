import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), tenantBookingUrl: vi.fn(() => "https://book") }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/ai-usage", () => ({ recordAiUsage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { draftWinBackPreview, sendWinBack, dismissWinBack } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["draftWinBackPreview", () => draftWinBackPreview("v1")],
  ["sendWinBack", () => sendWinBack("v1", "subj", null, null, { email: true, sms: false, whatsapp: false })],
  ["dismissWinBack", () => dismissWinBack("v1")],
])("%s denies without campaigns perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ campaigns: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
