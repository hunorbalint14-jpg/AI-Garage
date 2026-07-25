import type { StaffContext } from "@/lib/staff-context";
import type { Permissions } from "@/app/staff/staff-members/constants";
import { normalisePermissions } from "@/app/staff/staff-members/constants";

export function mockStaffContext(overrides: Partial<StaffContext> = {}): StaffContext {
  return {
    user: { id: "u_test", email: "test@garage.test", fullName: "Test User" },
    organization: { id: "o_test", slug: "test-garage", name: "Test Garage", primary_location_id: "l_test" },
    // Live by default — tests that care about prelive override live_at to null.
    location: { id: "l_test", slug: "test-garage", name: "Test Garage", live_at: "2026-01-01T00:00:00Z" },
    activeLocation: { id: "l_test", slug: "test-garage", name: "Test Garage", live_at: "2026-01-01T00:00:00Z" },
    accessibleLocations: [{ id: "l_test", slug: "test-garage", name: "Test Garage", live_at: "2026-01-01T00:00:00Z" }],
    branding: { primaryColor: null, logoUrl: null, dpaVersion: null },
    tenantBilling: {
      tenant_plan: "growth",
      tenant_subscription_status: "active",
      tenant_current_period_end: null,
      tenant_trial_end: null,
    },
    orgRole: "owner",
    locationRole: null,
    locationPermissions: null,
    motTester: false,
    motQcReviewer: false,
    supabase: {} as StaffContext["supabase"],
    ...overrides,
  };
}

// Build a non-org-role staff context with explicit location permissions.
// Defaults all keys to false then merges overrides — keeps tests focused
// on the perms they care about.
export function mockStaffContextMember(perms: Partial<Permissions> = {}): StaffContext {
  return mockStaffContext({
    orgRole: null,
    locationRole: "mechanic",
    locationPermissions: normalisePermissions(perms),
  });
}
