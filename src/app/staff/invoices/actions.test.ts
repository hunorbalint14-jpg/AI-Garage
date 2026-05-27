import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockStaffContextMember } from "@/test/helpers/staff-context-mock";

vi.mock("@/lib/staff-context", () => ({ requireStaffContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ tenantPayUrl: vi.fn(() => "https://pay") }));
vi.mock("@/lib/invoice-html", () => ({ buildInvoiceHtml: vi.fn(() => "<html/>") }));
vi.mock("@/lib/xero-sync", () => ({ pushInvoiceToXero: vi.fn(), pushPaymentToXero: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { requireStaffContext } = await import("@/lib/staff-context");
const { createInvoiceFromJob, sendInvoice, markInvoicePaid, deleteInvoice } = await import("./actions");

beforeEach(() => vi.clearAllMocks());

describe.each([
  ["createInvoiceFromJob", () => createInvoiceFromJob("j_1")],
  ["sendInvoice", () => sendInvoice("i_1")],
  ["markInvoicePaid", () => markInvoicePaid("i_1")],
  ["deleteInvoice", () => deleteInvoice("i_1")],
])("%s denies without invoices perm", (_name, run) => {
  it("returns Permission denied", async () => {
    vi.mocked(requireStaffContext).mockResolvedValue(mockStaffContextMember({ invoices: false }));
    expect(await run()).toEqual({ error: "Permission denied." });
  });
});
