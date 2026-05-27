import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai-job-from-voice", () => ({ structureVoiceNotes: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { structureTranscript, applyStructuredJob } = await import("./voice-actions");

beforeEach(() => vi.clearAllMocks());

describe("structureTranscript", () => {
  it("denies without bookings perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    expect(await structureTranscript("j_1", "do stuff")).toEqual({ error: "Permission denied." });
  });
});

describe("applyStructuredJob", () => {
  it("denies without bookings perm", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    const res = await applyStructuredJob("j_1", { items: [], summary: "" }, false);
    expect(res).toEqual({ error: "Permission denied." });
  });
});
