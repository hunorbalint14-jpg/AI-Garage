import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("./constants", () => ({ DEFAULT_PRODUCTS: [], PRODUCT_CATEGORIES: ["part", "labour"] }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createProduct, updateProduct, deleteProduct, adjustStock } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["createProduct", () => createProduct(new FormData())],
  ["updateProduct", () => updateProduct("p_1", {})],
  ["deleteProduct", () => deleteProduct("p_1")],
  ["adjustStock", () => adjustStock("p_1", 1)],
])("%s denies without products perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ products: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
