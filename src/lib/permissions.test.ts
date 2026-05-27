import { describe, it, expect } from "vitest";
import { hasPermission, requirePermission, canAccessMot, denied, PermissionDeniedError } from "./permissions";
import { mockStaffContext, mockStaffContextMember } from "@/test/helpers/staff-context-mock";

describe("hasPermission", () => {
  it("owner bypasses any key including hard-locked", () => {
    const ctx = mockStaffContext({ orgRole: "owner" });
    expect(hasPermission(ctx, "bookings")).toBe(true);
    expect(hasPermission(ctx, "invoices")).toBe(true);
    expect(hasPermission(ctx, "staff_manage")).toBe(true);
    expect(hasPermission(ctx, "org_settings")).toBe(true);
    expect(hasPermission(ctx, "gdpr_actions")).toBe(true);
  });

  it("admin bypasses any key", () => {
    const ctx = mockStaffContext({ orgRole: "admin" });
    expect(hasPermission(ctx, "stripe_connect")).toBe(true);
    expect(hasPermission(ctx, "audit_log")).toBe(true);
  });

  it("location user with the perm passes", () => {
    const ctx = mockStaffContextMember({ bookings: true, invoices: false });
    expect(hasPermission(ctx, "bookings")).toBe(true);
  });

  it("location user without the perm fails", () => {
    const ctx = mockStaffContextMember({ bookings: false });
    expect(hasPermission(ctx, "bookings")).toBe(false);
  });

  it("hard-locked perms reject location user even when ticked", () => {
    const ctx = mockStaffContextMember({
      staff_manage: true,
      org_settings: true,
      gdpr_actions: true,
    });
    expect(hasPermission(ctx, "staff_manage")).toBe(false);
    expect(hasPermission(ctx, "org_settings")).toBe(false);
    expect(hasPermission(ctx, "gdpr_actions")).toBe(false);
  });

  it("returns false when no perms object", () => {
    const ctx = mockStaffContext({ orgRole: null, locationPermissions: null });
    expect(hasPermission(ctx, "bookings")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("throws PermissionDeniedError when denied", () => {
    const ctx = mockStaffContextMember({ invoices: false });
    expect(() => requirePermission(ctx, "invoices")).toThrow(PermissionDeniedError);
  });

  it("does not throw when allowed", () => {
    const ctx = mockStaffContextMember({ invoices: true });
    expect(() => requirePermission(ctx, "invoices")).not.toThrow();
  });

  it("error carries the permission key", () => {
    const ctx = mockStaffContextMember({ invoices: false });
    try {
      requirePermission(ctx, "invoices");
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionDeniedError);
      expect((e as PermissionDeniedError).permission).toBe("invoices");
    }
  });
});

describe("denied()", () => {
  it("converts PermissionDeniedError to error payload", () => {
    const err = new PermissionDeniedError("invoices");
    expect(denied(err)).toEqual({ ok: false, error: "forbidden:invoices" });
  });

  it("re-throws non-permission errors", () => {
    const err = new Error("DB unreachable");
    expect(() => denied(err)).toThrow("DB unreachable");
  });
});

describe("canAccessMot", () => {
  it("true for org users", () => {
    expect(canAccessMot(mockStaffContext({ orgRole: "admin" }))).toBe(true);
  });

  it("true when mot_tester flag set", () => {
    const ctx = mockStaffContextMember({});
    ctx.motTester = true;
    expect(canAccessMot(ctx)).toBe(true);
  });

  it("true when mot_qc_reviewer flag set", () => {
    const ctx = mockStaffContextMember({});
    ctx.motQcReviewer = true;
    expect(canAccessMot(ctx)).toBe(true);
  });

  it("false for plain location user", () => {
    expect(canAccessMot(mockStaffContextMember({}))).toBe(false);
  });
});
