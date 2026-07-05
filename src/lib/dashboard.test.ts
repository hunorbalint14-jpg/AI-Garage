import { describe, it, expect } from "vitest";
import {
  anyWidgetVisible,
  buildPriorityItems,
  canFinance,
  classifyAttention,
  cumulativeWeeklySeries,
  dashboardWidgets,
  dueDays,
  fmtGBP,
  type AttentionVehicle,
  type OrgRole,
} from "./dashboard";
import {
  DEFAULT_PERMISSIONS,
  type PermissionKey,
  type Permissions,
} from "@/app/staff/staff-members/constants";

function permsFn(perms: Permissions | null): (key: PermissionKey) => boolean {
  return (key) => perms?.[key] === true;
}

// Owner/admin bypass in hasPermission; templates never reach them. Model that
// here so the matrix reads like the real page (page passes hasPermission(ctx)).
function roleCan(orgRole: OrgRole, template: string | null): (key: PermissionKey) => boolean {
  if (orgRole === "owner" || orgRole === "admin") return () => true;
  return permsFn(template ? DEFAULT_PERMISSIONS[template] : null);
}

const NOW = new Date("2026-07-05T12:00:00Z").getTime();

function vehicle(overrides: Partial<AttentionVehicle>): AttentionVehicle {
  return {
    id: crypto.randomUUID(),
    registration: "AB12CDE",
    make: "FORD",
    model: "FOCUS",
    mot_expiry: null,
    service_due: null,
    customer: null,
    ...overrides,
  };
}

describe("dueDays", () => {
  it("is positive for future dates and negative for past", () => {
    expect(dueDays("2026-07-10", NOW)).toBeGreaterThan(0);
    expect(dueDays("2026-07-01", NOW)).toBeLessThan(0);
  });
});

describe("cumulativeWeeklySeries", () => {
  it("walks back from the current total", () => {
    expect(cumulativeWeeklySeries([1, 2, 3], 10)).toEqual([5, 7, 10]);
  });

  it("handles empty series", () => {
    expect(cumulativeWeeklySeries([], 5)).toEqual([]);
  });
});

describe("fmtGBP", () => {
  it("formats whole pounds", () => {
    expect(fmtGBP(1234)).toBe("£1,234");
    expect(fmtGBP(0)).toBe("£0");
  });
});

describe("classifyAttention", () => {
  const overdueMot = vehicle({ mot_expiry: "2026-06-20" });
  const urgentService = vehicle({ service_due: "2026-07-12" });
  const soonMot = vehicle({ mot_expiry: "2026-08-20" });
  // Overdue on one dimension wins even when the other is merely urgent.
  const overdueBoth = vehicle({ mot_expiry: "2026-07-01", service_due: "2026-07-10" });

  it("splits overdue and urgent exclusively", () => {
    const { overdue, urgent } = classifyAttention(
      [overdueMot, urgentService, soonMot, overdueBoth],
      NOW,
    );
    expect(overdue).toEqual([overdueMot, overdueBoth]);
    expect(urgent).toEqual([urgentService]);
  });

  it("returns empty groups for empty input", () => {
    expect(classifyAttention([], NOW)).toEqual({ overdue: [], urgent: [] });
  });
});

describe("canFinance", () => {
  it("allows accountants only the finance allow-list", () => {
    const noPerms = permsFn(null);
    expect(canFinance("accountant", noPerms, "revenue")).toBe(true);
    expect(canFinance("accountant", noPerms, "invoices")).toBe(true);
    expect(canFinance("accountant", noPerms, "reports")).toBe(true);
    expect(canFinance("accountant", noPerms, "bookings")).toBe(false);
  });

  it("defers to hasPermission for everyone else", () => {
    expect(canFinance(null, permsFn(DEFAULT_PERMISSIONS.bookkeeper), "revenue")).toBe(true);
    expect(canFinance(null, permsFn(DEFAULT_PERMISSIONS.mechanic), "revenue")).toBe(false);
  });
});

describe("dashboardWidgets", () => {
  // Expected visibility per role template (null orgRole unless stated).
  // Keys: [bookingsOps, quotesPending, lowStock, reminders, revenue, invoices, growth, ownerRow, utilisation]
  const matrix: Record<string, [OrgRole, string | null, Partial<ReturnType<typeof dashboardWidgets>>]> = {
    owner: ["owner", null, { bookingsOps: true, quotesPending: true, lowStock: true, reminders: true, revenue: true, invoices: true, growth: true, ownerRow: true, utilisation: true }],
    accountant: ["accountant", null, { bookingsOps: false, quotesPending: false, lowStock: false, reminders: false, revenue: true, invoices: true, growth: false, ownerRow: true, utilisation: false }],
    manager: [null, "manager", { bookingsOps: true, quotesPending: true, lowStock: true, reminders: true, revenue: true, invoices: true, growth: false, ownerRow: false, utilisation: false }],
    service_advisor: [null, "service_advisor", { bookingsOps: true, quotesPending: true, lowStock: true, reminders: true, revenue: false, invoices: true, growth: false, ownerRow: false, utilisation: false }],
    mechanic: [null, "mechanic", { bookingsOps: true, quotesPending: true, lowStock: true, reminders: false, revenue: false, invoices: false, growth: false, ownerRow: false, utilisation: false }],
    apprentice: [null, "apprentice", { bookingsOps: true, quotesPending: false, lowStock: true, reminders: false, revenue: false, invoices: false, growth: false, ownerRow: false, utilisation: false }],
    receptionist: [null, "receptionist", { bookingsOps: true, quotesPending: true, lowStock: false, reminders: true, revenue: false, invoices: true, growth: false, ownerRow: false, utilisation: false }],
    parts: [null, "parts", { bookingsOps: false, quotesPending: false, lowStock: true, reminders: false, revenue: true, invoices: false, growth: false, ownerRow: false, utilisation: false }],
    bookkeeper: [null, "bookkeeper", { bookingsOps: false, quotesPending: true, lowStock: false, reminders: false, revenue: true, invoices: true, growth: false, ownerRow: false, utilisation: false }],
    staff: [null, "staff", { bookingsOps: true, quotesPending: false, lowStock: true, reminders: true, revenue: false, invoices: false, growth: false, ownerRow: false, utilisation: false }],
  };

  for (const [name, [orgRole, template, expected]] of Object.entries(matrix)) {
    it(`matches the ${name} template`, () => {
      expect(dashboardWidgets(orgRole, roleCan(orgRole, template))).toMatchObject(expected);
    });
  }

  it("shows something for every system template", () => {
    for (const template of Object.keys(DEFAULT_PERMISSIONS)) {
      expect(anyWidgetVisible(dashboardWidgets(null, roleCan(null, template)))).toBe(true);
    }
  });

  it("hides everything for a stripped-down custom template", () => {
    expect(anyWidgetVisible(dashboardWidgets(null, permsFn(null)))).toBe(false);
  });
});

describe("buildPriorityItems", () => {
  const emptyInput = {
    uninvoicedJobs: 0,
    expiringQuotes: { count: 0, total: 0 },
    invoicesOpen: { draft_count: 0, draft_total: 0, sent_count: 0, sent_total: 0 },
    overdueCount: 0,
    urgentCount: 0,
  };

  it("falls back to all-caught-up", () => {
    const items = buildPriorityItems(emptyInput);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ n: "01", title: "All caught up", href: "/staff/revenue" });
  });

  it("orders and numbers all six actions", () => {
    const items = buildPriorityItems({
      uninvoicedJobs: 2,
      expiringQuotes: { count: 1, total: 450 },
      invoicesOpen: { draft_count: 3, draft_total: 900, sent_count: 1, sent_total: 250 },
      overdueCount: 4,
      urgentCount: 5,
    });
    expect(items.map((i) => i.n)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(items.map((i) => i.href)).toEqual([
      "/staff/jobs",
      "/staff/quotes",
      "/staff/reminders",
      "/staff/invoices",
      "/staff/invoices",
      "/staff/reminders",
    ]);
    expect(items[0].title).toBe("Invoice 2 finished jobs");
    expect(items[1].title).toBe("1 quote expiring within 3 days");
    expect(items[3].title).toBe("Send 3 draft invoices");
    expect(items[4].impact).toBe("£250");
  });

  it("uses singular forms", () => {
    const items = buildPriorityItems({
      ...emptyInput,
      uninvoicedJobs: 1,
      overdueCount: 1,
    });
    expect(items[0].title).toBe("Invoice 1 finished job");
    expect(items[1].title).toBe("Send reminders — 1 overdue vehicle");
  });

  it("keeps numbering contiguous when only some actions fire", () => {
    const items = buildPriorityItems({
      ...emptyInput,
      invoicesOpen: { draft_count: 0, draft_total: 0, sent_count: 2, sent_total: 100 },
      urgentCount: 3,
    });
    expect(items.map((i) => i.n)).toEqual(["01", "02"]);
    expect(items[0].title).toBe("Chase 2 unpaid invoices");
    expect(items[1].title).toBe("Book 3 vehicles due within 14 days");
  });

  const busyInput = {
    uninvoicedJobs: 2,
    expiringQuotes: { count: 1, total: 450 },
    invoicesOpen: { draft_count: 3, draft_total: 900, sent_count: 1, sent_total: 250 },
    overdueCount: 4,
    urgentCount: 5,
  };

  it("drops invoice and quote actions the role cannot act on", () => {
    const items = buildPriorityItems(busyInput, {
      invoices: false,
      quotesSend: false,
      reminders: true,
      revenue: false,
    });
    expect(items.map((i) => i.href)).toEqual(["/staff/reminders", "/staff/reminders"]);
    expect(items.map((i) => i.n)).toEqual(["01", "02"]);
  });

  it("falls back to bookings when the role has no revenue access", () => {
    const items = buildPriorityItems(emptyInput, {
      invoices: false,
      quotesSend: false,
      reminders: false,
      revenue: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe("/staff/bookings");
    expect(items[0].body).toBe("No urgent actions today.");
  });
});
