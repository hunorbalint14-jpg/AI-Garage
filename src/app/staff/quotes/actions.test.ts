import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/quote-links", () => ({
  generateQuoteToken: vi.fn(() => "tok"),
  generateStandaloneQuoteSlug: vi.fn(() => "sq-abc"),
  hashQuoteToken: vi.fn(() => "h"),
  tenantQuoteUrl: vi.fn(() => "https://test/q"),
}));
vi.mock("@/lib/quote-storage", () => ({
  QUOTE_VIDEO_MAX_BYTES: 1_000_000,
  isAllowedVideoMime: vi.fn(() => true),
  createUploadUrl: vi.fn(),
  videoObjectExists: vi.fn(),
  standaloneVideoPath: vi.fn(() => "path"),
  removeVideoObject: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const {
  prepareStandaloneQuoteUpload,
  createStandaloneQuote,
  sendStandaloneQuoteDraft,
  sendFreshStandaloneQuote,
  updateStandaloneQuoteDraft,
  cancelStandaloneQuote,
} = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe("draft-perm actions", () => {
  it("prepareStandaloneQuoteUpload denies without quotes_draft", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: false }));
    expect(await prepareStandaloneQuoteUpload("video/mp4", 1, "mp4")).toEqual({ error: "Permission denied." });
  });

  it("createStandaloneQuote (draft mode) denies without quotes_draft", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: false }));
    const res = await createStandaloneQuote({ customerId: "c", items: [] });
    expect(res).toEqual({ error: "Permission denied." });
  });

  it("createStandaloneQuote with sendImmediately requires quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: true, quotes_send: false }));
    const res = await createStandaloneQuote({ customerId: "c", items: [], sendImmediately: true });
    expect(res).toEqual({ error: "Permission denied." });
  });

  it("updateStandaloneQuoteDraft denies without quotes_draft", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: false }));
    expect(await updateStandaloneQuoteDraft({ quoteId: "q" })).toEqual({ error: "Permission denied." });
  });
});

describe("send-perm actions", () => {
  it("sendStandaloneQuoteDraft denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await sendStandaloneQuoteDraft("q")).toEqual({ error: "Permission denied." });
  });

  it("sendFreshStandaloneQuote denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await sendFreshStandaloneQuote("q", "tok")).toEqual({ error: "Permission denied." });
  });

  it("cancelStandaloneQuote denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await cancelStandaloneQuote("q")).toEqual({ error: "Permission denied." });
  });
});
