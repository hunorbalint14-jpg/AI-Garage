import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContext, mockStaffContextMember } from "@/test/helpers/staff-context-mock";

// Mock all I/O deps before importing the module under test.
vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), tenantBookingUrl: vi.fn(() => "https://book.test") }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/bay-availability", () => ({ isBayFreeAt: vi.fn().mockResolvedValue(true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const {
  createBooking,
  startBooking,
  cancelBooking,
  markNoShow,
  assignBay,
  deleteBooking,
} = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBooking permission gate", () => {
  it("rejects member without bookings perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    const fd = new FormData();
    fd.set("customerId", "c_1");
    fd.set("scheduledAt", "2026-06-01T10:00:00Z");
    fd.set("type", "service");
    const res = await createBooking(fd);
    expect(res).toEqual({ error: "Permission denied." });
  });

  it("owner is allowed", async () => {
    // No DB mock here so the action will fail past the perm check; we only
    // assert it does NOT return Permission denied.
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContext({ orgRole: "owner" }));
    const fd = new FormData();
    const res = await createBooking(fd);
    expect(res).not.toEqual({ error: "Permission denied." });
  });
});

describe.each([
  ["startBooking", startBooking],
  ["cancelBooking", cancelBooking],
  ["markNoShow", markNoShow],
  ["deleteBooking", deleteBooking],
])("%s permission gate", (_name, fn) => {
  it("denies member without bookings perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    const res = await fn("b_1");
    expect(res).toEqual({ error: "Permission denied." });
  });
});

describe("assignBay permission gate", () => {
  it("denies member without bookings perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    const res = await assignBay("b_1", null);
    expect(res).toEqual({ error: "Permission denied." });
  });
});
