import type { SupabaseClient } from "@supabase/supabase-js";

// Demo sandbox (#506 PR 3): a small, curated dataset an owner can explore and
// wipe without touching real records. Every row carries is_demo — the flag IS
// the filter, so the wipe can't catch anything real. Emails use @demo.invalid
// (undeliverable by construction) and comms crons additionally skip is_demo.
// NB: scripts/seed-demo.ts is the LOCAL-ONLY screenshot seed; this is the
// production per-org sandbox. They are deliberately separate.

// Structurally identical to the admin client — typed via supabase-js so the
// module stays importable outside the Next server (drive scripts, tests).
type Admin = SupabaseClient;

const r2 = (n: number) => Math.round(n * 100) / 100;
const dayShift = (days: number, hour = 9, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const dateShift = (days: number) => dayShift(days).slice(0, 10);

export async function hasDemoData(admin: Admin, organizationId: string): Promise<boolean> {
  const { count } = await admin
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("is_demo", true);
  return (count ?? 0) > 0;
}

// Delete in dependency order, always keyed on org + is_demo. job_items ride
// the jobs cascade. jobs/bookings carry no organization_id — they scope
// through the org's locations instead. Safe to run when nothing is seeded.
export async function wipeDemoData(admin: Admin, organizationId: string): Promise<{ error?: string }> {
  const { data: locs, error: locErr } = await admin.from("locations").select("id").eq("organization_id", organizationId);
  if (locErr) return { error: `locations: ${locErr.message}` };
  const locIds = (locs ?? []).map((l) => l.id as string);

  for (const table of ["quotes", "invoices", "jobs", "bookings", "vehicles", "customers"] as const) {
    let del = admin.from(table).delete().eq("is_demo", true);
    del =
      table === "jobs" || table === "bookings"
        ? del.in("location_id", locIds.length > 0 ? locIds : ["00000000-0000-0000-0000-000000000000"])
        : del.eq("organization_id", organizationId);
    const { error } = await del;
    if (error) return { error: `${table}: ${error.message}` };
  }
  return {};
}

const DEMO_CUSTOMERS = [
  { name: "Priya Sharma", email: "priya@demo.invalid", phone: "07700 900101" },
  { name: "Tom Wallace", email: "tom@demo.invalid", phone: "07700 900102" },
  { name: "Grace Chen", email: "grace@demo.invalid", phone: "07700 900103" },
  { name: "Ryan O'Neill", email: "ryan@demo.invalid", phone: "07700 900104" },
  { name: "Ellie Foster", email: "ellie@demo.invalid", phone: "07700 900105" },
  { name: "Marcus Reid", email: "marcus@demo.invalid", phone: "07700 900106" },
] as const;

const DEMO_VEHICLES = [
  { reg: "DM19 AAA", make: "Audi", model: "A3", year: 2019, motDays: 21, serviceDays: 90 },
  { reg: "DM66 BBB", make: "Ford", model: "Focus", year: 2016, motDays: -5, serviceDays: 10 },
  { reg: "DM21 CCC", make: "Kia", model: "Sportage", year: 2021, motDays: 140, serviceDays: 45 },
  { reg: "DM14 DDD", make: "BMW", model: "320d", year: 2014, motDays: 60, serviceDays: 200 },
  { reg: "DM20 EEE", make: "Volkswagen", model: "Polo", year: 2020, motDays: 12, serviceDays: 12 },
  { reg: "DM18 FFF", make: "Toyota", model: "Corolla", year: 2018, motDays: 310, serviceDays: 160 },
] as const;

// Seed the sandbox on the given branch. Idempotent: wipes any previous demo
// rows first, so re-running resets rather than duplicates.
export async function seedDemoData(
  admin: Admin,
  organizationId: string,
  locationId: string,
): Promise<{ error?: string; customers?: number }> {
  const wiped = await wipeDemoData(admin, organizationId);
  if (wiped.error) return { error: wiped.error };

  const { data: custRows, error: custErr } = await admin
    .from("customers")
    .insert(
      DEMO_CUSTOMERS.map((c) => ({
        organization_id: organizationId,
        preferred_location_id: locationId,
        full_name: c.name,
        email: c.email,
        phone: c.phone,
        is_demo: true,
      })),
    )
    .select("id");
  if (custErr || !custRows) return { error: custErr?.message ?? "customer seed failed" };
  const custIds = custRows.map((r) => r.id as string);

  const { data: vehRows, error: vehErr } = await admin
    .from("vehicles")
    .insert(
      DEMO_VEHICLES.map((v, i) => ({
        location_id: locationId,
        customer_id: custIds[i],
        registration: v.reg,
        make: v.make,
        model: v.model,
        year: v.year,
        mot_expiry: dateShift(v.motDays),
        service_due: dateShift(v.serviceDays),
        is_demo: true,
      })),
    )
    .select("id");
  if (vehErr || !vehRows) return { error: vehErr?.message ?? "vehicle seed failed" };
  const vehIds = vehRows.map((r) => r.id as string);

  // A working week of bookings.
  const { error: bookErr } = await admin.from("bookings").insert(
    [
      { c: 0, v: 0, at: dayShift(1, 9), type: "MOT Test", mins: 60 },
      { c: 2, v: 2, at: dayShift(1, 11), type: "Full Service", mins: 120 },
      { c: 3, v: 3, at: dayShift(2, 10), type: "Brake Inspection", mins: 60 },
      { c: 4, v: 4, at: dayShift(4, 9, 30), type: "MOT + Service", mins: 150 },
      { c: 5, v: 5, at: dayShift(5, 14), type: "Diagnostics", mins: 60 },
    ].map((b) => ({
      location_id: locationId,
      customer_id: custIds[b.c],
      vehicle_id: vehIds[b.v],
      scheduled_at: b.at,
      duration_minutes: b.mins,
      type: b.type,
      status: "scheduled",
      is_demo: true,
    })),
  );
  if (bookErr) return { error: bookErr.message };

  // Jobs at three stages: open diagnosis, wrenches-out, and completed+invoiced.
  const { data: jobRows, error: jobErr } = await admin
    .from("jobs")
    .insert([
      {
        location_id: locationId,
        customer_id: custIds[2],
        vehicle_id: vehIds[2],
        status: "open",
        description: "Investigate engine warning light",
        is_demo: true,
      },
      {
        location_id: locationId,
        customer_id: custIds[1],
        vehicle_id: vehIds[1],
        // Board vocabulary is open | complete | invoiced — "open" is the
        // on-the-floor column.
        status: "open",
        description: "Front brake discs & pads",
        is_demo: true,
      },
      {
        location_id: locationId,
        customer_id: custIds[5],
        vehicle_id: vehIds[5],
        status: "complete",
        description: "Interim service + MOT",
        completed_at: dayShift(-2, 16),
        is_demo: true,
      },
    ])
    .select("id");
  if (jobErr || !jobRows) return { error: jobErr?.message ?? "job seed failed" };
  const jobIds = jobRows.map((r) => r.id as string);

  const items = [
    { job: 1, description: "Labour — brakes", type: "labour", quantity: 1.5, unit_price: 75 },
    { job: 1, description: "Front brake discs (pair)", type: "part", quantity: 1, unit_price: 89.99 },
    { job: 1, description: "Front brake pads (set)", type: "part", quantity: 1, unit_price: 45.5 },
    { job: 2, description: "Interim service", type: "labour", quantity: 1, unit_price: 120 },
    { job: 2, description: "MOT test", type: "labour", quantity: 1, unit_price: 54.85 },
    { job: 2, description: "Oil filter", type: "part", quantity: 1, unit_price: 12.4 },
  ];
  const { error: itemErr } = await admin.from("job_items").insert(
    items.map((it) => ({
      job_id: jobIds[it.job],
      description: it.description,
      type: it.type,
      quantity: it.quantity,
      unit_price: it.unit_price,
      vat_rate: 20,
    })),
  );
  if (itemErr) return { error: itemErr.message };

  // One sent invoice off the completed job (ex-VAT lines + 20%).
  const subtotal = r2(120 + 54.85 + 12.4);
  const vat = r2(subtotal * 0.2);
  const { error: invErr } = await admin.from("invoices").insert({
    location_id: locationId,
    customer_id: custIds[5],
    job_id: jobIds[2],
    invoice_number: "DEMO-0001",
    status: "sent",
    subtotal,
    vat_rate: 20,
    vat_amount: vat,
    total: r2(subtotal + vat),
    issued_at: dateShift(-2),
    due_at: dateShift(12),
    is_demo: true,
  });
  if (invErr) return { error: invErr.message };

  // One pending upsell quote on the in-progress job. No public link (token
  // stays null) — it exists so the pipeline has something in it.
  const { error: quoteErr } = await admin.from("quotes").insert({
    quote_type: "job",
    organization_id: organizationId,
    location_id: locationId,
    job_id: jobIds[1],
    customer_id: custIds[1],
    vehicle_id: vehIds[1],
    title: "Rear tyres — 2 × Michelin Primacy",
    description: "Both rear tyres at 2.5mm — replacement recommended.",
    subtotal: 200,
    vat_rate: 20,
    vat_amount: 40,
    total: 240,
    status: "pending",
    sent_at: new Date().toISOString(),
    expires_at: dayShift(7),
    is_demo: true,
  });
  if (quoteErr) return { error: quoteErr.message };

  return { customers: custIds.length };
}
