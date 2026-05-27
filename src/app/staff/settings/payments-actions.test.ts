import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: { accounts: { retrieve: vi.fn() } }, publicOrigin: vi.fn(() => "https://x") }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { startStripeConnect, refreshStripeAccountStatus } = await import("./payments-actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["startStripeConnect", () => startStripeConnect()],
  ["refreshStripeAccountStatus", () => refreshStripeAccountStatus()],
])("%s denies without stripe_connect perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ stripe_connect: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
