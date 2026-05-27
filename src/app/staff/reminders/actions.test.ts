import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), tenantBookingUrl: vi.fn(() => "https://book") }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: vi.fn() }; },
}));
vi.mock("@/lib/ai-messages", () => ({
  fallbackReminderMessage: vi.fn(() => ""),
  fallbackSmsReminderMessage: vi.fn(() => ""),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { draftReminderPreview, sendReminderDraft } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["draftReminderPreview", () => draftReminderPreview("v_1", "mot")],
  ["sendReminderDraft", () => sendReminderDraft("v_1", "mot", null, null, { email: false, sms: false, whatsapp: false })],
])("%s denies without reminders perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ reminders: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
