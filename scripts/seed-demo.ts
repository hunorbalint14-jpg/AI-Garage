/*
 * Demo-data seed for the user-manual screenshots.
 *
 *   npm run help:seed
 *
 * Builds a deterministic, populated tenant on the existing `smith-motors` org so
 * every section of the manual renders with real content. Idempotent (safe to
 * re-run) and HARD-GUARDED to local Supabase only — it uses the service-role key
 * and creates auth users, so it must never touch a real project.
 *
 * Each step is isolated: a column/schema mismatch logs and is skipped rather than
 * aborting the whole seed, so most of the UI still populates and the gap is
 * obvious. Tighten individual steps as the schema evolves.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_TENANT_SLUG,
  DEMO_PASSWORD,
  DEMO_STAFF,
  DEMO_CUSTOMER,
} from "./demo-constants";

// ── env: load .env.local (tsx doesn't do this for us) ────────────────────────
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(file: string) {
  const p = path.join(REPO, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// ── prod guard — refuse anything that isn't obviously local ──────────────────
function assertLocal(url: string) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Bad NEXT_PUBLIC_SUPABASE_URL: ${JSON.stringify(url)}`);
  }
  const local =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith("localtest.me");
  if (!local) {
    throw new Error(
      `Refusing to seed: ${host} is not local. This script only runs against a local Supabase (localhost/127.0.0.1). Set NEXT_PUBLIC_SUPABASE_URL to your local instance.`,
    );
  }
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (check .env.local).");
  process.exit(1);
}
assertLocal(SUPABASE_URL);

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── tiny helpers ─────────────────────────────────────────────────────────────
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
let okCount = 0;
let failCount = 0;

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const r = await fn();
    okCount++;
    console.log(`  ✓ ${name}`);
    return r;
  } catch (err) {
    failCount++;
    console.warn(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Throw on a Supabase error (or empty result) so `step` catches it. */
function must<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data == null) throw new Error("no rows returned");
  return res.data as NonNullable<T>;
}

async function findOrCreateAuthUser(email: string, fullName: string): Promise<string> {
  // Page through existing users (local instances are tiny) to stay idempotent.
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;
  const created = await db.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (created.error) throw new Error(created.error.message);
  return created.data.user.id;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSeeding demo data on '${DEMO_TENANT_SLUG}' at ${new URL(SUPABASE_URL).host}\n`);

  // Org + primary location must already exist (supabase/seed.sql).
  const org = await step("locate organization", async () =>
    must(await db.from("organizations").select("id, slug, name").eq("slug", DEMO_TENANT_SLUG).single()),
  );
  if (!org) {
    console.error("\nCould not find the org — run `supabase db seed` first. Aborting.\n");
    process.exit(1);
  }
  const orgId = org.id as string;

  const loc = await step("locate primary location", async () =>
    must(
      await db
        .from("locations")
        .select("id, slug, name")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .single(),
    ),
  );
  if (!loc) {
    console.error("\nNo location for the org. Aborting.\n");
    process.exit(1);
  }
  const locId = loc.id as string;

  // Branding + DPA acceptance (the staff portal redirects to /staff/dpa-acceptance
  // until the org's dpa_version matches CURRENT_DPA_VERSION — "1.0").
  await step("set org branding + accept DPA", async () => {
    must(
      await db
        .from("organizations")
        .update({
          name: "Smith Motors",
          primary_color: "#dc2626",
          dpa_version: "1.0",
          dpa_accepted_at: new Date().toISOString(),
        })
        .eq("id", orgId)
        .select("id"),
    );
  });

  // A second branch so the location switcher has something to show.
  await step("second location (branch switcher)", async () => {
    const existing = await db.from("locations").select("id").eq("slug", `${DEMO_TENANT_SLUG}-eastside`).maybeSingle();
    if (existing.data) return;
    must(
      await db
        .from("locations")
        .insert({ organization_id: orgId, slug: `${DEMO_TENANT_SLUG}-eastside`, name: "Smith Motors — Eastside" })
        .select("id"),
    );
  });

  // Staff owner + customer auth users (+ memberships / customer row).
  const staffUserId = await step("staff owner auth user", () =>
    findOrCreateAuthUser(DEMO_STAFF.email, DEMO_STAFF.fullName),
  );
  if (staffUserId) {
    await step("owner org membership", async () => {
      const existing = await db.from("org_users").select("user_id").eq("user_id", staffUserId).eq("organization_id", orgId).maybeSingle();
      if (existing.data) return;
      must(await db.from("org_users").insert({ user_id: staffUserId, organization_id: orgId, role: "owner" }).select("user_id"));
    });
  }

  const customerUserId = await step("customer auth user", () =>
    findOrCreateAuthUser(DEMO_CUSTOMER.email, DEMO_CUSTOMER.fullName),
  );
  let customerId: string | null = null;
  if (customerUserId) {
    customerId = await step("customer record", async () => {
      const existing = await db
        .from("customers")
        .select("id")
        .eq("organization_id", orgId)
        .eq("email", DEMO_CUSTOMER.email)
        .maybeSingle();
      if (existing.data) return existing.data.id as string;
      const row = must(
        await db
          .from("customers")
          .insert({
            organization_id: orgId,
            preferred_location_id: locId,
            user_id: customerUserId,
            full_name: DEMO_CUSTOMER.fullName,
            email: DEMO_CUSTOMER.email,
            phone: DEMO_CUSTOMER.phone,
            marketing_email_consent: true,
            marketing_sms_consent: false,
          })
          .select("id")
          .single(),
      );
      return row.id as string;
    });
  }

  // Services (id keyed by name so we can reference MOT + Full Service later).
  const SERVICES = [
    { name: "MOT Test", category: "mot", duration_minutes: 60, price: 54.85 },
    { name: "Full Service", category: "service", duration_minutes: 120, price: 189 },
    { name: "Interim Service", category: "service", duration_minutes: 75, price: 119 },
    { name: "Brake Inspection", category: "repair", duration_minutes: 45, price: 39 },
    { name: "Diagnostics", category: "repair", duration_minutes: 60, price: 59 },
  ];
  const serviceIds: Record<string, string> = {};
  await step("services catalogue", async () => {
    for (const s of SERVICES) {
      const existing = await db.from("services").select("id").eq("location_id", locId).eq("name", s.name).maybeSingle();
      if (existing.data) {
        serviceIds[s.name] = existing.data.id as string;
        continue;
      }
      const row = must(
        await db.from("services").insert({ location_id: locId, active: true, ...s }).select("id").single(),
      );
      serviceIds[s.name] = row.id as string;
    }
  });

  // Bays.
  await step("workshop bays", async () => {
    const names = ["Bay 1", "Bay 2", "MOT Bay"];
    for (let i = 0; i < names.length; i++) {
      const existing = await db.from("bays").select("id").eq("location_id", locId).eq("name", names[i]).maybeSingle();
      if (existing.data) continue;
      must(await db.from("bays").insert({ location_id: locId, name: names[i], sort_order: i }).select("id"));
    }
  });

  // Products (parts inventory).
  await step("parts inventory", async () => {
    const products = [
      { name: "Oil filter", category: "Filters", sku: "OF-100", unit_price: 12.5, cost_price: 5.2, stock_qty: 24, reorder_at: 6 },
      { name: "Brake pads (front)", category: "Brakes", sku: "BP-220", unit_price: 48, cost_price: 22, stock_qty: 4, reorder_at: 6 },
      { name: "Wiper blade", category: "Consumables", sku: "WB-019", unit_price: 9.99, cost_price: 3.1, stock_qty: 40, reorder_at: 10 },
    ];
    for (const p of products) {
      const existing = await db.from("products").select("id").eq("location_id", locId).eq("name", p.name).maybeSingle();
      if (existing.data) continue;
      must(await db.from("products").insert({ location_id: locId, active: true, ...p }).select("id"));
    }
  });

  if (!customerId) {
    console.log("\nNo customer record — skipping customer-scoped data.\n");
    return summary();
  }

  // Vehicles with a spread of MOT/service/tax states (green / amber / red).
  const vehicleIds: string[] = [];
  await step("customer vehicles", async () => {
    const vehicles = [
      {
        registration: "AB19 CDE", make: "Volkswagen", model: "Golf", year: 2019,
        mot_expiry: isoDate(daysFromNow(18)), service_due: isoDate(daysFromNow(40)), tax_due_date: isoDate(daysFromNow(12)),
      },
      {
        registration: "LD68 KMV", make: "Ford", model: "Fiesta", year: 2018,
        mot_expiry: isoDate(daysFromNow(210)), service_due: isoDate(daysFromNow(150)), tax_due_date: isoDate(daysFromNow(180)),
      },
    ];
    for (const v of vehicles) {
      const existing = await db.from("vehicles").select("id").eq("customer_id", customerId).eq("registration", v.registration).maybeSingle();
      if (existing.data) {
        vehicleIds.push(existing.data.id as string);
        continue;
      }
      const row = must(
        await db.from("vehicles").insert({ organization_id: orgId, location_id: locId, customer_id: customerId, ...v }).select("id").single(),
      );
      vehicleIds.push(row.id as string);
    }
  });

  const motId = serviceIds["MOT Test"];
  const fullServiceId = serviceIds["Full Service"];
  const v0 = vehicleIds[0] ?? null;

  // Bookings: one upcoming, one completed.
  await step("bookings (upcoming + completed)", async () => {
    const rows = [
      { scheduled_at: daysFromNow(3).toISOString(), type: "mot", status: "scheduled", service_id: motId, notes: "Annual MOT" },
      { scheduled_at: daysFromNow(-10).toISOString(), type: "service", status: "complete", service_id: fullServiceId, notes: "Full service" },
    ];
    for (const r of rows) {
      const existing = await db.from("bookings").select("id").eq("customer_id", customerId).eq("scheduled_at", r.scheduled_at).maybeSingle();
      if (existing.data) continue;
      must(
        await db
          .from("bookings")
          .insert({ location_id: locId, customer_id: customerId, vehicle_id: v0, duration_minutes: 60, ...r })
          .select("id"),
      );
    }
  });

  // A completed job with line items (feeds Jobs board, history and invoices).
  let jobId: string | null = null;
  await step("completed job + items", async () => {
    const existing = await db.from("jobs").select("id").eq("customer_id", customerId).eq("description", "Full service & brake check").maybeSingle();
    if (existing.data) {
      jobId = existing.data.id as string;
      return;
    }
    const job = must(
      await db
        .from("jobs")
        .insert({ location_id: locId, customer_id: customerId, vehicle_id: v0, description: "Full service & brake check", status: "completed" })
        .select("id")
        .single(),
    );
    jobId = job.id as string;
    must(
      await db
        .from("job_items")
        .insert([
          { job_id: jobId, description: "Full Service", type: "labour", quantity: 1, unit_price: 189, service_id: fullServiceId },
          { job_id: jobId, description: "Oil filter", type: "part", quantity: 1, unit_price: 12.5 },
          { job_id: jobId, description: "Brake pads (front)", type: "part", quantity: 1, unit_price: 48 },
        ])
        .select("id"),
    );
  });

  // Invoices: one sent (links the job so line items render), one paid.
  await step("invoices (sent + paid)", async () => {
    const invoices = [
      { invoice_number: "INV-DEMO-001", subtotal: 249.5, vat_rate: 20, vat_amount: 49.9, total: 299.4, status: "sent", job_id: jobId },
      { invoice_number: "INV-DEMO-002", subtotal: 54.85, vat_rate: 20, vat_amount: 10.97, total: 65.82, status: "paid", job_id: null },
    ];
    for (const inv of invoices) {
      const existing = await db.from("invoices").select("id").eq("location_id", locId).eq("invoice_number", inv.invoice_number).maybeSingle();
      if (existing.data) continue;
      must(
        await db
          .from("invoices")
          .insert({
            location_id: locId,
            customer_id: customerId,
            issued_at: isoDate(daysFromNow(-8)),
            due_at: isoDate(daysFromNow(22)),
            ...inv,
          })
          .select("id"),
      );
    }
  });

  // Service plan + active subscription + a consumed allowance row (so the plans
  // pages + coverage badges have something to show).
  await step("service plan + active subscription", async () => {
    let planId: string;
    const existingPlan = await db.from("service_plans").select("id").eq("location_id", locId).eq("name", "Complete Care").maybeSingle();
    if (existingPlan.data) {
      planId = existingPlan.data.id as string;
    } else {
      const plan = must(
        await db
          .from("service_plans")
          .insert({
            location_id: locId,
            name: "Complete Care",
            description: "MOT + full service every year, plus 10% off everything else.",
            price_monthly_pence: 1999,
            price_annual_pence: 19900,
            discount_type: "percent",
            discount_value: 10,
            active: true,
            created_by: staffUserId,
          })
          .select("id")
          .single(),
      );
      planId = plan.id as string;
      if (motId) must(await db.from("service_plan_items").insert({ service_plan_id: planId, service_id: motId, quantity_per_period: 1 }).select("service_plan_id"));
      if (fullServiceId) must(await db.from("service_plan_items").insert({ service_plan_id: planId, service_id: fullServiceId, quantity_per_period: 1 }).select("service_plan_id"));
    }

    const periodEnd = daysFromNow(25).toISOString();
    const existingSub = await db.from("plan_subscriptions").select("id").eq("customer_id", customerId).eq("service_plan_id", planId).maybeSingle();
    let subId: string;
    if (existingSub.data) {
      subId = existingSub.data.id as string;
    } else {
      const sub = must(
        await db
          .from("plan_subscriptions")
          .insert({
            organization_id: orgId,
            location_id: locId,
            service_plan_id: planId,
            customer_id: customerId,
            stripe_subscription_id: `sub_demo_${DEMO_TENANT_SLUG}`,
            interval: "month",
            status: "active",
            current_period_end: periodEnd,
            cancel_at_period_end: false,
            paid_in_pence: 12000,
            benefits_start_at: daysFromNow(-1).toISOString(),
          })
          .select("id")
          .single(),
      );
      subId = sub.id as string;
    }

    // One consumed MOT this period (shows "0 left" / drawn value on the plan UI).
    if (motId) {
      const existingUse = await db.from("plan_service_usage").select("id").eq("plan_subscription_id", subId).eq("service_id", motId).maybeSingle();
      if (!existingUse.data) {
        must(
          await db
            .from("plan_service_usage")
            .insert({ plan_subscription_id: subId, service_id: motId, period_end: periodEnd, covered_qty: 1, walk_in_pence: 5485, status: "consumed" })
            .select("id"),
        );
      }
    }
  });

  summary();
}

function summary() {
  console.log(`\nDone — ${okCount} steps ok, ${failCount} skipped.`);
  console.log(`Staff login:    ${DEMO_STAFF.email} / ${DEMO_PASSWORD}`);
  console.log(`Customer login: ${DEMO_CUSTOMER.email} / ${DEMO_PASSWORD}\n`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err);
  process.exit(1);
});
