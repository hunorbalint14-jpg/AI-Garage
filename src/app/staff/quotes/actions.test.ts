import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/sms", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsApp: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/quote-links", () => ({
  generateQuoteToken: vi.fn(() => "tok"),
  generateQuoteSlug: vi.fn(() => "q-abc"),
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
vi.mock("@/lib/encryption", () => ({ encrypt: vi.fn((v: string) => `enc:${v}`), decrypt: vi.fn((v: string) => v) }));
vi.mock("@/lib/quote-reminders", () => ({
  dispatchQuoteReminder: vi.fn(async () => ({ channels: [] })),
  encryptLinkToken: vi.fn((v: string) => `enc:${v}`),
}));
vi.mock("../bookings/actions", () => ({ createBooking: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const {
  prepareStandaloneQuoteUpload,
  createStandaloneQuote,
  sendStandaloneQuoteDraft,
  sendFreshStandaloneQuote,
  updateStandaloneQuoteDraft,
  cancelStandaloneQuote,
  reviseQuote,
  sendManualReminder,
  convertQuoteToBooking,
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

describe("reviseQuote", () => {
  const validArgs = {
    quoteId: "q",
    items: [{ description: "Pads", type: "part" as const, quantity: 1, unit_price: 10 }],
    revisionNote: "Added pads",
    channels: ["email" as const],
  };

  it("denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await reviseQuote(validArgs)).toEqual({ error: "Permission denied." });
  });

  it("requires a non-empty customer-facing note", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: true }));
    const res = await reviseQuote({ ...validArgs, revisionNote: "   " });
    expect(res).toEqual({ error: "A customer-facing note describing what changed is required." });
  });

  it("requires at least one channel", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: true }));
    const res = await reviseQuote({ ...validArgs, channels: [] });
    expect(res).toEqual({ error: "Select at least one channel to notify the customer." });
  });

  it("requires at least one line item", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: true }));
    const res = await reviseQuote({ ...validArgs, items: [] });
    expect(res).toEqual({ error: "Add at least one line item." });
  });
});

describe("sendManualReminder", () => {
  it("denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await sendManualReminder({ quoteId: "q", channels: ["email"] })).toEqual({ error: "Permission denied." });
  });

  it("requires at least one channel", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: true }));
    expect(await sendManualReminder({ quoteId: "q", channels: [] })).toEqual({ error: "Select at least one channel." });
  });
});

describe("convertQuoteToBooking", () => {
  it("denies without bookings permission", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: false }));
    expect(await convertQuoteToBooking({ quoteId: "q", scheduledAt: "2026-07-10T10:00" })).toEqual({
      error: "Permission denied.",
    });
  });

  it("requires a scheduled time", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ bookings: true }));
    expect(await convertQuoteToBooking({ quoteId: "q", scheduledAt: "  " })).toEqual({
      error: "Pick a date and time for the booking.",
    });
  });
});
