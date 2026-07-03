import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => ({ ok: true })),
  tooManyAttemptsError: vi.fn(() => ({ error: "Too many attempts." })),
}));
vi.mock("@/lib/ai-diagnostic", () => ({ runDiagnostic: vi.fn() }));
vi.mock("@/lib/ai-labour", () => ({ estimateLabourTime: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { runDiagnostic } = await import("@/lib/ai-diagnostic");
const { estimateLabourTime } = await import("@/lib/ai-labour");
const { seedQuoteFromDiagnostic } = await import("./ai-actions");

beforeEach(() => vi.clearAllMocks());

const DIAGNOSIS = {
  likelyCauses: [{ cause: "Worn front brake pads", probability: "likely" as const }],
  urgency: "soon" as const,
  urgencyNote: "Should be inspected within two weeks.",
  estimatedCost: "£150–£250 (parts and labour)",
  recommendedAction: "Replace front brake pads and inspect discs",
};

describe("seedQuoteFromDiagnostic", () => {
  it("denies without quotes_draft", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: false }));
    expect(await seedQuoteFromDiagnostic({ symptom: "grinding noise" })).toEqual({
      error: "Permission denied.",
    });
  });

  it("requires a symptom", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: true }));
    expect(await seedQuoteFromDiagnostic({ symptom: "   " })).toEqual({
      error: "Describe the symptom first.",
    });
  });

  it("returns a draft seeded from the diagnosis + labour estimate", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: true }));
    vi.mocked(runDiagnostic).mockResolvedValue(DIAGNOSIS);
    vi.mocked(estimateLabourTime).mockResolvedValue({ hours: 1.5, note: "Standard time" });

    const result = await seedQuoteFromDiagnostic({
      symptom: "grinding noise when braking",
      vehicleDescription: "2019 VW Golf",
      vehicleReg: "AB19 CDE",
    });
    expect(result).toEqual({
      success: true,
      title: "Diagnostic findings — AB19 CDE",
      customerMessage:
        "Should be inspected within two weeks. Recommended: Replace front brake pads and inspect discs",
      items: [
        {
          description: "Replace front brake pads and inspect discs",
          type: "labour",
          quantity: 1.5,
          unit_price: 0,
          note: "Standard time",
        },
      ],
      diagnosis: DIAGNOSIS,
    });
  });

  it("degrades gracefully when the AI call fails", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ quotes_draft: true }));
    vi.mocked(runDiagnostic).mockRejectedValue(new Error("boom"));
    expect(await seedQuoteFromDiagnostic({ symptom: "grinding noise" })).toEqual({
      error: "AI suggestion unavailable right now — build the quote manually.",
    });
  });
});
