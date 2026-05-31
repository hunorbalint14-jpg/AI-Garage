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
const { createAdminClient } = await import("@/lib/supabase/admin");
const { sendEmail } = await import("@/lib/email");
const { sendSms } = await import("@/lib/sms");
const { logAudit } = await import("@/lib/audit");
const { prepareQuoteUpload, createQuote, sendQuoteWithToken, cancelQuote, remindQuote } = await import("./quote-actions");

beforeEach(() => vi.clearAllMocks());

// Chainable Supabase mock: select(...).eq(...).maybeSingle() resolves the row;
// update(...).eq(...).eq(...) is awaited for { error }. Captures update payloads.
function mockAdmin(quoteRow: unknown) {
  const updates: Record<string, unknown>[] = [];
  const make = () => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (payload: Record<string, unknown>) => { updates.push(payload); return chain; },
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: quoteRow }),
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    return chain;
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => make()) } as unknown as ReturnType<typeof createAdminClient>);
  return { updates };
}

function jobQuoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q_1",
    job_id: "j_1",
    location_id: "l_test",
    slug: "q-abc",
    title: "Brake pads",
    description: "Worn",
    total: 120,
    status: "pending",
    token_hash: "old-hash",
    last_reminded_at: null,
    job: {
      customer: { full_name: "Jane Doe", email: "jane@test.dev", phone: "07700900000" },
      vehicle: { registration: "AB12CDE" },
    },
    ...overrides,
  };
}

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

describe("remindQuote", () => {
  beforeEach(() => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: true }));
  });

  it("denies without quotes_send", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_send: false }));
    expect(await remindQuote("q_1")).toEqual({ error: "Permission denied." });
  });

  it("rejects a non-pending quote", async () => {
    mockAdmin(jobQuoteRow({ status: "approved" }));
    expect(await remindQuote("q_1")).toEqual({ error: "Only pending quotes can be reminded." });
  });

  it("rejects when the customer has no email or phone", async () => {
    mockAdmin(jobQuoteRow({ job: { customer: { full_name: "Jane", email: null, phone: null }, vehicle: { registration: "AB12CDE" } } }));
    expect(await remindQuote("q_1")).toEqual({ error: "Customer has no email or phone — cannot notify." });
  });

  it("rotates the token, re-sends, and logs quote.remind", async () => {
    const { updates } = mockAdmin(jobQuoteRow());
    vi.mocked(sendEmail).mockResolvedValue({ success: true, messageId: "m1" } as Awaited<ReturnType<typeof sendEmail>>);
    vi.mocked(sendSms).mockResolvedValue({ success: true, messageSid: "s1" } as Awaited<ReturnType<typeof sendSms>>);

    const res = await remindQuote("q_1");

    expect(res).toEqual({ success: true, channels: ["email", "sms"], customerUrl: "https://test/q" });
    // First update rotates the hash (mocked hashQuoteToken → "h") + stamps a reminder time.
    expect(updates[0].token_hash).toBe("h");
    expect(typeof updates[0].last_reminded_at).toBe("string");
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "quote.remind", entityType: "job_quote", entityId: "q_1" }),
    );
  });
});
