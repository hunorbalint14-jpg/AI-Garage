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
  // until the org's dpa_version matches CURRENT_DPA_VERSION — "1.0") + the owner
  // AI-setup gate (redirects everything to /staff/onboarding until
  // ai_onboarded_at is set).
  await step("set org branding + accept DPA + AI onboarding", async () => {
    must(
      await db
        .from("organizations")
        .update({
          name: "Smith Motors",
          primary_color: "#dc2626",
          dpa_version: "1.0",
          dpa_accepted_at: new Date().toISOString(),
          ai_onboarded_at: new Date().toISOString(),
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
    // INV-DEMO-001 below links this job, so its app status is "invoiced"
    // (the board's third column). "completed" is not a job status the app
    // ever writes — completeJob() sets "complete".
    const job = must(
      await db
        .from("jobs")
        .insert({ location_id: locId, customer_id: customerId, vehicle_id: v0, description: "Full service & brake check", status: "invoiced", completed_at: daysFromNow(-6).toISOString() })
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

  // A finished-but-unbilled job — exercises the jobs board's "Done ·
  // unbilled" column (aging escalation + one-click INVOICE →).
  await step("unbilled completed job + items", async () => {
    const existing = await db.from("jobs").select("id").eq("customer_id", customerId).eq("description", "Clutch replacement").maybeSingle();
    if (existing.data) return;
    const job = must(
      await db
        .from("jobs")
        .insert({ location_id: locId, customer_id: customerId, vehicle_id: v0, description: "Clutch replacement", status: "complete", completed_at: daysFromNow(-9).toISOString() })
        .select("id")
        .single(),
    );
    must(
      await db
        .from("job_items")
        .insert([
          { job_id: job.id as string, description: "Clutch kit", type: "part", quantity: 1, unit_price: 320 },
          { job_id: job.id as string, description: "Labour", type: "labour", quantity: 1, unit_price: 190 },
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

  // ── Manual v2 additions: data for the wider staff-page coverage ────────────

  // A pending quote the customer can open/approve (customer quotes pages +
  // staff quotes register + the approve-quote video).
  await step("pending quote + items", async () => {
    const existing = await db.from("quotes").select("id").eq("organization_id", orgId).eq("title", "Front brake discs & pads").maybeSingle();
    if (existing.data) return;
    const quote = must(
      await db
        .from("quotes")
        .insert({
          quote_type: "standalone",
          organization_id: orgId,
          location_id: locId,
          created_by: staffUserId,
          customer_id: customerId,
          vehicle_id: v0,
          title: "Front brake discs & pads",
          description: "Found on inspection during the full service.",
          customer_message: "Front discs are lipped and pads are at 3mm — recommend replacing both before the next MOT.",
          subtotal: 190,
          vat_rate: 20,
          vat_amount: 38,
          total: 228,
          status: "pending",
          slug: "demo-brakes-quote",
          token_hash: "0".repeat(64), // never a real link — portal pages don't need the raw token
          sent_at: daysFromNow(-2).toISOString(),
          expires_at: daysFromNow(12).toISOString(),
        })
        .select("id")
        .single(),
    );
    must(
      await db.from("quote_items").insert([
        { quote_id: quote.id, description: "Front brake discs (pair)", type: "part", quantity: 1, unit_price: 98, sort_order: 0 },
        { quote_id: quote.id, description: "Front brake pads", type: "part", quantity: 1, unit_price: 44, sort_order: 1 },
        { quote_id: quote.id, description: "Fitting", type: "labour", quantity: 1, unit_price: 48, sort_order: 2 },
      ]).select("id"),
    );
  });

  // Suppliers + a purchase order (Suppliers + Purchase orders pages).
  let supplierId: string | null = null;
  await step("suppliers", async () => {
    const suppliers = [
      { name: "MotorParts Direct", contact_email: "orders@motorparts.example", contact_phone: "0161 000 0001", notes: "Next-day on brake components." },
      { name: "TyreHub Wholesale", contact_email: "sales@tyrehub.example", contact_phone: "0161 000 0002", notes: null },
    ];
    for (const s of suppliers) {
      const existing = await db.from("suppliers").select("id").eq("location_id", locId).eq("name", s.name).maybeSingle();
      if (existing.data) {
        supplierId ??= existing.data.id as string;
        continue;
      }
      const row = must(await db.from("suppliers").insert({ location_id: locId, ...s }).select("id").single());
      supplierId ??= row.id as string;
    }
  });

  await step("purchase order + items", async () => {
    if (!supplierId) throw new Error("no supplier");
    const existing = await db.from("purchase_orders").select("id").eq("location_id", locId).eq("reference", "PO-DEMO-001").maybeSingle();
    if (existing.data) return;
    const pads = await db.from("products").select("id").eq("location_id", locId).eq("name", "Brake pads (front)").maybeSingle();
    const po = must(
      await db
        .from("purchase_orders")
        .insert({
          location_id: locId,
          supplier_id: supplierId,
          reference: "PO-DEMO-001",
          status: "ordered",
          notes: "Restock before the weekend rush.",
          created_by: staffUserId,
          ordered_at: daysFromNow(-1).toISOString(),
        })
        .select("id")
        .single(),
    );
    must(
      await db.from("purchase_order_items").insert([
        { purchase_order_id: po.id, product_id: pads.data?.id ?? null, description: "Brake pads (front)", quantity: 10, unit_cost: 22, sort_order: 0 },
        { purchase_order_id: po.id, product_id: null, description: "Brake discs (pair)", quantity: 4, unit_cost: 55, sort_order: 1 },
      ]).select("id"),
    );
  });

  // Courtesy cars: one available, one out on loan (Courtesy cars page + tile).
  await step("courtesy cars + live loan", async () => {
    const cars = [
      { registration: "CC70 AAA", make: "Toyota", model: "Aygo", notes: "Small + economical." },
      { registration: "CC71 BBB", make: "Kia", model: "Picanto", notes: null },
    ];
    const carIds: string[] = [];
    for (const c of cars) {
      const existing = await db.from("courtesy_cars").select("id").eq("location_id", locId).eq("registration", c.registration).maybeSingle();
      if (existing.data) {
        carIds.push(existing.data.id as string);
        continue;
      }
      const row = must(await db.from("courtesy_cars").insert({ location_id: locId, active: true, ...c }).select("id").single());
      carIds.push(row.id as string);
    }
    const existingLoan = await db.from("courtesy_car_loans").select("id").eq("car_id", carIds[0]).is("returned_at", null).maybeSingle();
    if (!existingLoan.data && carIds[0]) {
      must(
        await db
          .from("courtesy_car_loans")
          .insert({
            location_id: locId,
            car_id: carIds[0],
            customer_id: customerId,
            job_id: jobId,
            loaned_at: daysFromNow(-1).toISOString(),
            due_back_at: daysFromNow(1).toISOString(),
            fuel_out: 6, // eighths of a tank — 6/8 = ¾

            odometer_out: 24310,
            condition_out: "Clean, small scuff rear bumper.",
            created_by: staffUserId,
          })
          .select("id"),
      );
    }
  });

  // A fleet company (Fleet page).
  await step("fleet company", async () => {
    const existing = await db.from("fleet_companies").select("id").eq("location_id", locId).eq("name", "Speedy Couriers Ltd").maybeSingle();
    if (existing.data) return;
    must(
      await db
        .from("fleet_companies")
        .insert({
          location_id: locId,
          name: "Speedy Couriers Ltd",
          contact_name: "Dana Fleet",
          contact_email: "fleet@speedy.example",
          contact_phone: "0161 000 0003",
          notes: "12 vans; MOTs staggered quarterly.",
        })
        .select("id"),
    );
  });

  // A tyre check on the completed job's vehicle (job detail + customer history).
  await step("tyre check", async () => {
    if (!v0) throw new Error("no vehicle");
    const existing = await db.from("tyre_checks").select("id").eq("vehicle_id", v0).maybeSingle();
    if (existing.data) return;
    must(
      await db
        .from("tyre_checks")
        .insert({
          vehicle_id: v0,
          location_id: locId,
          checked_at: daysFromNow(-10).toISOString(),
          nsf_depth: 4.5, osf_depth: 4.2, nsr_depth: 6.1, osr_depth: 6.0,
          notes: "Fronts approaching 3mm — advise replacement within 6 months.",
        })
        .select("id"),
    );
  });

  // Staff notifications for the owner (bell + Notifications page).
  await step("staff notifications", async () => {
    if (!staffUserId) throw new Error("no staff user");
    const rows = [
      { kind: "booking.created", title: "New booking request", body: "Charlie Customer requested an MOT for AB19 CDE." },
      { kind: "invoice.paid", title: "Invoice paid", body: "INV-DEMO-002 (£65.82) was paid by card." },
      { kind: "quote.approved", title: "Quote viewed", body: "Charlie Customer viewed 'Front brake discs & pads'." },
    ];
    for (const n of rows) {
      const existing = await db.from("staff_notifications").select("id").eq("user_id", staffUserId).eq("title", n.title).maybeSingle();
      if (existing.data) continue;
      must(
        await db
          .from("staff_notifications")
          .insert({ user_id: staffUserId, location_id: locId, organization_id: orgId, href: "/staff", ...n })
          .select("id"),
      );
    }
  });

  // ── 2026.07.3 wave (#497–#508): rows the new manual sections shoot ─────────

  await step("trade account on Charlie + statement history", async () => {
    if (!customerId) throw new Error("no customer");
    must(
      await db
        .from("customers")
        .update({ account_customer: true, payment_terms_days: 30, credit_limit: 2000, consolidated_billing: true })
        .eq("id", customerId)
        .select("id"),
    );
    // One open account invoice + a part-payment so the panel/statement shots
    // show a real balance (idempotent by invoice number).
    const existing = await db.from("invoices").select("id").eq("invoice_number", "SMI-ACC-0001").maybeSingle();
    if (!existing.data) {
      const inv = must(
        await db
          .from("invoices")
          .insert({
            location_id: locId,
            organization_id: orgId,
            customer_id: customerId,
            invoice_number: "SMI-ACC-0001",
            status: "sent",
            subtotal: 400,
            vat_rate: 20,
            vat_amount: 80,
            total: 480,
            amount_paid: 200,
            issued_at: isoDate(daysFromNow(-20)),
            due_at: isoDate(daysFromNow(10)),
          })
          .select("id")
          .single(),
      );
      const pay = must(
        await db
          .from("payments")
          .insert({
            location_id: locId,
            organization_id: orgId,
            customer_id: customerId,
            amount: 200,
            method: "bank_transfer",
            reference: "BACS 2201",
            received_at: isoDate(daysFromNow(-6)),
          })
          .select("id")
          .single(),
      );
      must(await db.from("payment_allocations").insert({ payment_id: pay.id, invoice_id: inv.id, amount: 200 }).select("id"));
    }
  });

  await step("deferred-work bank rows", async () => {
    if (!customerId) throw new Error("no customer");
    const { data: veh } = await db.from("vehicles").select("id").eq("customer_id", customerId).limit(1).maybeSingle();
    const rows = [
      { description: "Rear brake pads at 3mm — replace soon", price: 138, rag: "amber" as const },
      { description: "Front tyres on the legal limit", price: 210, rag: "red" as const },
    ];
    for (const r of rows) {
      const existing = await db.from("deferred_work").select("id").eq("description", r.description).maybeSingle();
      if (existing.data) continue;
      must(
        await db
          .from("deferred_work")
          .insert({
            location_id: locId,
            organization_id: orgId,
            customer_id: customerId,
            vehicle_id: veh?.id ?? null,
            source: "quote_item",
            status: "open",
            followup_count: 1,
            last_followup_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
            ...r,
          })
          .select("id"),
      );
    }
  });

  await step("signed work authorisation", async () => {
    if (!customerId) throw new Error("no customer");
    const { data: job } = await db.from("jobs").select("id").eq("customer_id", customerId).limit(1).maybeSingle();
    const existing = await db.from("work_authorisations").select("id").eq("signed_name", "Charlie Customer").maybeSingle();
    if (existing.data) return;
    must(
      await db
        .from("work_authorisations")
        .insert({
          location_id: locId,
          organization_id: orgId,
          job_id: job?.id ?? null,
          customer_id: customerId,
          kind: "initial",
          method: "quote_approval",
          status: "authorised",
          authorised_total: 228,
          items_snapshot: [
            { description: "Front brake discs (pair)", total: 120 },
            { description: "Front brake pads + fitting", total: 108 },
          ],
          signed_name: "Charlie Customer",
          authorised_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        })
        .select("id"),
    );
  });

  await step("imported service history + past invoice", async () => {
    if (!customerId) throw new Error("no customer");
    const { data: veh } = await db.from("vehicles").select("id").eq("customer_id", customerId).limit(1).maybeSingle();
    if (!veh) throw new Error("no vehicle");
    const entries = [
      { happened_on: "2024-03-05", mileage: 41200, description: "Full service, oil & filters (previous system)", total: 189.5 },
      { happened_on: "2024-11-12", mileage: 47810, description: "Cambelt & water pump replaced (previous system)", total: 486 },
    ];
    for (const e of entries) {
      const existing = await db.from("vehicle_history_entries").select("id").eq("description", e.description).maybeSingle();
      if (existing.data) continue;
      must(
        await db
          .from("vehicle_history_entries")
          .insert({ organization_id: orgId, vehicle_id: veh.id, source: "import", ...e })
          .select("id"),
      );
    }
    const inv = await db.from("imported_invoices").select("id").eq("invoice_number", "TM-4471").maybeSingle();
    if (!inv.data) {
      must(
        await db
          .from("imported_invoices")
          .insert({
            organization_id: orgId,
            customer_id: customerId,
            vehicle_id: veh.id,
            invoice_number: "TM-4471",
            issued_on: "2023-05-14",
            total: 312.4,
            status: "Paid",
            description: "Clutch replacement (previous system)",
          })
          .select("id"),
      );
    }
  });

  await step("mini-site settings row (unpublished — root stays the splash)", async () => {
    must(
      await db
        .from("org_sites")
        .upsert({
          organization_id: orgId,
          published: false,
          strapline: "Colindale's honest garage — MOTs while you wait.",
          about: "Family-run since 1998. DVSA-approved MOT centre with four bays.",
        })
        .select("organization_id"),
    );
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
