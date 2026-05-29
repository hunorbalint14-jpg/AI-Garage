import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), tenantBookingUrl: vi.fn(() => "https://book.test") }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/registration", () => ({ normalizeRegistration: (s: string) => s, validateRegistration: () => null }));
vi.mock("@/lib/dvla", () => ({ lookupVehicle: vi.fn() }));
vi.mock("@/lib/dvla-ves", () => ({ lookupVehicleVes: vi.fn() }));
vi.mock("@/lib/dvsa-recalls", () => ({ checkVehicleRecalls: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const {
  addCustomer,
  addVehicle,
  sendReminder,
  draftMessagePreview,
  sendDraftedMessage,
  updateCustomer,
  deleteCustomer,
  updateVehicle,
  deleteVehicle,
} = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["addCustomer", () => addCustomer(new FormData())],
  ["addVehicle", () => addVehicle("c_1", new FormData())],
  ["updateCustomer", () => updateCustomer("c_1", new FormData())],
  ["deleteCustomer", () => deleteCustomer("c_1")],
  ["updateVehicle", () => updateVehicle("v_1", "c_1", new FormData())],
  ["deleteVehicle", () => deleteVehicle("v_1", "c_1")],
])("%s denies without customers perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ customers: false }));
    const res = await run();
    expect(res).toEqual({ error: "Permission denied." });
  });
});

describe.each([
  ["sendReminder", () => sendReminder("v_1", "mot")],
  ["draftMessagePreview", () => draftMessagePreview("c_1", "topic", ["email"])],
  ["sendDraftedMessage", () => sendDraftedMessage("c_1", "topic", null, null, null)],
])("%s denies without reminders perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ reminders: false }));
    const res = await run();
    expect(res).toEqual({ error: "Permission denied." });
  });
});
