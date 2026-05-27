import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));
vi.mock("@/lib/ai-labour", () => ({ estimateLabourTime: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const {
  addJobItem,
  removeJobItem,
  updateJobItem,
  updateJob,
  completeJob,
  reopenJob,
  sendReviewRequest,
  deleteJob,
} = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["addJobItem", () => addJobItem("j_1", new FormData())],
  ["removeJobItem", () => removeJobItem("j_1", "i_1")],
  ["updateJobItem", () => updateJobItem("j_1", "i_1", 1, 10)],
  ["updateJob", () => updateJob("j_1", new FormData())],
  ["completeJob", () => completeJob("j_1")],
  ["reopenJob", () => reopenJob("j_1")],
  ["deleteJob", () => deleteJob("j_1")],
])("%s denies without bookings perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});

describe("sendReviewRequest", () => {
  it("denies without reminders perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ reminders: false }));
    expect(await sendReviewRequest("j_1")).toEqual({ error: "Permission denied." });
  });
});
