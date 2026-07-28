import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSupabaseMock } from "@/test/helpers/supabase-mock";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/encryption", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
}));
vi.mock("./xero-provider", () => ({ refreshXeroTokens: vi.fn(), xeroProvider: {} }));
vi.mock("./quickbooks-provider", () => ({ refreshQuickBooksTokens: vi.fn(), quickBooksProvider: {} }));
vi.mock("./sage-provider", () => ({ refreshSageTokens: vi.fn(), sageProvider: {} }));

const { createAdminClient } = await import("@/lib/supabase/admin");
const { saveAccountingConnection } = await import("./connection");

beforeEach(() => vi.clearAllMocks());

const ORIGINAL_CONNECTED_AT = "2026-01-05T10:00:00.000Z";

const baseArgs = {
  organizationId: "org_1",
  provider: "xero" as const,
  externalId: "tenant-1",
  displayName: "Smith Motors Ltd",
  accessToken: "at",
  refreshToken: "rt",
  tokenExpiresAt: "2026-07-28T12:00:00.000Z",
  connectedBy: "u_owner",
};

function mockExisting(row: { provider: string; external_id: string } | null) {
  const admin = createSupabaseMock({
    data: row ? { ...row, connected_at: ORIGINAL_CONNECTED_AT } : null,
  });
  vi.mocked(createAdminClient).mockReturnValue(admin as never);
  return admin;
}

function upsertPayload(admin: ReturnType<typeof createSupabaseMock>) {
  expect(admin._chain.upsert).toHaveBeenCalledTimes(1);
  return admin._chain.upsert.mock.calls[0][0] as Record<string, unknown>;
}

// The reconnect-needed banner tells owners "anything issued in the meantime
// backfills automatically" — that only holds if a same-company reconnect
// preserves connected_at, the anchor of the backfill window and the
// books-health counts.
describe("saveAccountingConnection connected_at", () => {
  it("same provider + same company keeps the original connected_at and clears the reconnect episode", async () => {
    const admin = mockExisting({ provider: "xero", external_id: "tenant-1" });

    await saveAccountingConnection(baseArgs);

    const payload = upsertPayload(admin);
    expect(payload.connected_at).toBe(ORIGINAL_CONNECTED_AT);
    expect(payload).toMatchObject({
      access_token: "enc:at",
      refresh_token: "enc:rt",
      display_name: "Smith Motors Ltd",
      connected_by: "u_owner",
      needs_reconnect: false,
      last_refresh_error: null,
      last_refresh_error_at: null,
      reconnect_alerted_at: null,
    });
    // No ledger switch → entity mappings stay intact.
    expect(admin.from).not.toHaveBeenCalledWith("invoices");
    expect(admin.from).not.toHaveBeenCalledWith("customers");
    expect(admin.from).not.toHaveBeenCalledWith("credit_notes");
  });

  it("provider switch resets connected_at and wipes entity mappings", async () => {
    const admin = mockExisting({ provider: "xero", external_id: "tenant-1" });

    await saveAccountingConnection({ ...baseArgs, provider: "quickbooks", externalId: "realm-9" });

    const payload = upsertPayload(admin);
    expect(payload.connected_at).not.toBe(ORIGINAL_CONNECTED_AT);
    expect(Number.isNaN(new Date(payload.connected_at as string).getTime())).toBe(false);
    expect(admin.from).toHaveBeenCalledWith("invoices");
    expect(admin.from).toHaveBeenCalledWith("customers");
    expect(admin.from).toHaveBeenCalledWith("credit_notes");
  });

  it("same provider but a different company also resets connected_at", async () => {
    const admin = mockExisting({ provider: "xero", external_id: "tenant-1" });

    await saveAccountingConnection({ ...baseArgs, externalId: "tenant-OTHER" });

    const payload = upsertPayload(admin);
    expect(payload.connected_at).not.toBe(ORIGINAL_CONNECTED_AT);
    expect(admin.from).toHaveBeenCalledWith("invoices");
  });

  it("first-ever connection stamps a fresh connected_at", async () => {
    const admin = mockExisting(null);

    await saveAccountingConnection(baseArgs);

    const payload = upsertPayload(admin);
    expect(Number.isNaN(new Date(payload.connected_at as string).getTime())).toBe(false);
    expect(admin.from).not.toHaveBeenCalledWith("invoices");
  });
});
