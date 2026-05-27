import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/slug", () => ({ validateSlug: vi.fn(() => null) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { updateOrganization, updateBusinessHours, addLocation } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["updateOrganization", () => updateOrganization(new FormData())],
  ["updateBusinessHours", () => updateBusinessHours(new FormData())],
  ["addLocation", () => addLocation(new FormData())],
])("%s denies location user (org_settings hard-locked)", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ org_settings: true }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
