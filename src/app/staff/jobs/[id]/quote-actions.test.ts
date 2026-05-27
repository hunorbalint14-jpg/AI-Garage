import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/quote-links", () => ({
  generateQuoteToken: vi.fn(() => "tok"),
  generateQuoteSlug: vi.fn(() => "q-abc"),
  hashQuoteToken: vi.fn(() => "h"),
  tenantQuoteUrl: vi.fn(() => "https://test/q"),
}));
vi.mock("@/lib/quote-storage", () => ({
  QUOTE_VIDEO_MAX_BYTES: 1_000_000,
  isAllowedVideoMime: vi.fn(() => true),
  createUploadUrl: vi.fn(),
  videoObjectExists: vi.fn(),
  videoPath: vi.fn(() => "path"),
  removeVideoObject: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { prepareQuoteUpload, createQuote, sendQuoteWithToken, cancelQuote } = await import("./quote-actions");

beforeEach(() => vi.clearAllMocks());

describe("prepareQuoteUpload / createQuote (draft perm)", () => {
  it("prepareQuoteUpload denies without quotes_draft", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: false }));
    expect(await prepareQuoteUpload("j_1", "video/mp4", 1000, "mp4")).toEqual({ error: "Permission denied." });
  });

  it("createQuote denies without quotes_draft", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: false }));
    const res = await createQuote({
      jobId: "j", quoteId: "q", videoPath: "p", videoMime: "video/mp4", videoSizeBytes: 1, items: [],
    });
    expect(res).toEqual({ error: "Permission denied." });
  });
});

describe("sendQuoteWithToken / cancelQuote (send perm)", () => {
  it("sendQuoteWithToken denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await sendQuoteWithToken("q", "tok")).toEqual({ error: "Permission denied." });
  });

  it("cancelQuote denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await cancelQuote("q")).toEqual({ error: "Permission denied." });
  });
});
