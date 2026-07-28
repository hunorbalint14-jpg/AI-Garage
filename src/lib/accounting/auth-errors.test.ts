import { describe, expect, it } from "vitest";
import { isTenantAuthError, normalizeSyncError, syncErrorMessage } from "./auth-errors";

// xero-node rejects a plain object, not an Error — the shape a revoked
// tenant actually produces (refresh succeeds, every API call 403s).
const XERO_REVOKED_REJECTION = {
  response: { statusCode: 403 },
  body: {
    Type: null,
    Title: "Forbidden",
    Status: 403,
    Detail: "AuthenticationUnsuccessful",
    Instance: "00000000-0000-0000-0000-000000000000",
  },
};

describe("isTenantAuthError — xero", () => {
  it("matches the 403 AuthenticationUnsuccessful rejection object", () => {
    expect(isTenantAuthError("xero", XERO_REVOKED_REJECTION)).toBe(true);
  });

  it("matches when the detail only survives inside an Error message", () => {
    expect(
      isTenantAuthError("xero", new Error('Xero API 403: {"Title":"Forbidden","Detail":"AuthenticationUnsuccessful"}')),
    ).toBe(true);
  });

  it("ignores validation rejections", () => {
    expect(
      isTenantAuthError("xero", {
        response: { statusCode: 400 },
        body: {
          Type: "ValidationException",
          Elements: [{ ValidationErrors: [{ Message: "Invoice # must be unique." }] }],
        },
      }),
    ).toBe(false);
  });

  it("ignores ordinary provider errors", () => {
    expect(isTenantAuthError("xero", new Error("Xero createInvoices returned no invoice"))).toBe(false);
    expect(isTenantAuthError("xero", new Error("No BANK account found in Xero"))).toBe(false);
  });
});

describe("isTenantAuthError — quickbooks", () => {
  it("matches a 401 AUTHENTICATION fault (qboApi-wrapped)", () => {
    expect(
      isTenantAuthError(
        "quickbooks",
        new Error(
          "QuickBooks GET /query 401: message=AuthenticationFailed; errorCode=003200; statusCode=401 — Token expired: AB01157",
        ),
      ),
    ).toBe(true);
  });

  it("matches invalid_token", () => {
    expect(
      isTenantAuthError("quickbooks", new Error("QuickBooks POST /invoice 401: invalid_token — token revoked")),
    ).toBe(true);
  });

  it("needs BOTH the 401 and an auth-flavoured body", () => {
    // 401 without auth words (e.g. echoed line text) — no match.
    expect(isTenantAuthError("quickbooks", new Error("QuickBooks POST /invoice 400: part #401 not found"))).toBe(false);
    // Auth words without 401 — business validation, not tenant auth.
    expect(
      isTenantAuthError(
        "quickbooks",
        new Error("QuickBooks POST /customer 400: Duplicate Name Exists Error — authentication of names (code 6240)"),
      ),
    ).toBe(false);
  });
});

describe("isTenantAuthError — sage", () => {
  it("matches 401 Unauthorised", () => {
    expect(isTenantAuthError("sage", new Error("Sage GET /contacts 401: Unauthorised [Unauthorised]"))).toBe(true);
  });

  it("matches 403 Forbidden", () => {
    expect(isTenantAuthError("sage", new Error("Sage POST /sales_invoices 403: Forbidden"))).toBe(true);
  });

  it("ignores validation errors", () => {
    expect(
      isTenantAuthError("sage", new Error("Sage POST /sales_invoices 422: Reference is too long (contact.reference)")),
    ).toBe(false);
  });
});

describe("isTenantAuthError — provider dispatch", () => {
  it("unknown provider never matches", () => {
    expect(isTenantAuthError("freeagent", new Error("401 Unauthorised invalid_token"))).toBe(false);
  });
});

describe("normalizeSyncError", () => {
  it("extracts status and body from a xero-node rejection object", () => {
    const n = normalizeSyncError(XERO_REVOKED_REJECTION);
    expect(n.status).toBe(403);
    expect(n.text).toContain("AuthenticationUnsuccessful");
  });

  it("handles Error / string / null", () => {
    expect(normalizeSyncError(new Error("boom"))).toEqual({ status: null, text: "boom" });
    expect(normalizeSyncError("raw text")).toEqual({ status: null, text: "raw text" });
    expect(normalizeSyncError(null)).toEqual({ status: null, text: "" });
  });
});

describe("syncErrorMessage", () => {
  it("keeps Error messages verbatim", () => {
    expect(syncErrorMessage(new Error("QuickBooks POST /invoice 401: invalid_token"))).toBe(
      "QuickBooks POST /invoice 401: invalid_token",
    );
  });

  it("serialises non-Error rejections instead of [object Object]", () => {
    const msg = syncErrorMessage(XERO_REVOKED_REJECTION);
    expect(msg).toContain("AuthenticationUnsuccessful");
    expect(msg).not.toBe("[object Object]");
  });
});
