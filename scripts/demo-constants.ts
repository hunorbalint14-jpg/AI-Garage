// Shared demo identity + tenant, imported by BOTH the seed (scripts/seed-demo.ts)
// and the screenshot harness (e2e/screenshots/helpers.ts) so credentials never
// drift between "what we create" and "what we log in as".
//
// Everything here is for LOCAL demo data only — never real users.

export const DEMO_TENANT_SLUG = process.env.HELP_TENANT_SLUG ?? "smith-motors";

export const DEMO_PASSWORD = process.env.HELP_DEMO_PASSWORD ?? "DemoPassw0rd!";

export const DEMO_STAFF = {
  email: "owner@smith-motors.demo",
  fullName: "Olivia Owner",
};

export const DEMO_CUSTOMER = {
  email: "demo.customer@smith-motors.demo",
  fullName: "Charlie Customer",
  phone: "+447700900123",
};
