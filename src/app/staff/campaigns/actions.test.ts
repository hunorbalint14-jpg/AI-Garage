import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), tenantBookingUrl: vi.fn(() => "https://book") }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/ai-messages", () => ({ draftBroadcastMessage: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { draftBroadcastPreview, sendBroadcast } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["draftBroadcastPreview", () => draftBroadcastPreview("topic", ["email"])],
  ["sendBroadcast", () => sendBroadcast("subj", null, null, null)],
])("%s denies without campaigns perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ campaigns: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
