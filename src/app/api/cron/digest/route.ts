import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeEqual } from "@/lib/safe-equal";
import { sendEmail } from "@/lib/email";

// Runs every Monday at 08:00 UTC via Vercel Cron.
// Sends a weekly MOT/service due report to org owners and admins.
export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOW_DAYS_DEFAULT = 30;

async function getTaskConfig(
  admin: ReturnType<typeof createAdminClient>,
  locationId: string,
): Promise<{ enabled: boolean; window_days: number }> {
  const { data } = await admin
    .from("scheduled_tasks")
    .select("enabled, settings")
    .eq("location_id", locationId)
    .eq("task_type", "weekly_digest")
    .maybeSingle();
  return {
    enabled: data?.enabled ?? true,
    window_days: ((data?.settings as Record<string, unknown> | null)?.window_days as number) ?? WINDOW_DAYS_DEFAULT,
  };
}

type VehicleRow = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  mot_expiry: string | null;
  service_due: string | null;
  customer: { full_name: string | null; email: string | null } | null;
};

type LocationRow = {
  id: string;
  name: string;
  organization: { id: string; name: string; logo_url: string | null } | null;
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function rowColor(days: number): string {
  if (days <= 7) return "#dc2626";
  if (days <= 14) return "#d97706";
  return "#374151";
}

function buildDigestHtml(orgName: string, rows: { customerName: string; vehicle: string; registration: string; type: string; dueDate: string; days: number }[], windowDays: number, logoUrl: string | null): string {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const tableRows = rows
    .sort((a, b) => a.days - b.days)
    .map((r) => `
      <tr style="border-top:1px solid #e5e7eb">
        <td data-label="Customer" style="padding:8px 12px;color:${rowColor(r.days)};font-weight:${r.days <= 7 ? "600" : "400"}">${r.days <= 7 ? "⚠️ " : ""}${r.customerName}</td>
        <td data-label="Vehicle" style="padding:8px 12px;color:#6b7280">${r.vehicle}</td>
        <td data-label="Reg" style="padding:8px 12px;font-family:monospace">${r.registration}</td>
        <td data-label="Type" style="padding:8px 12px;text-transform:uppercase;font-size:12px;font-weight:600">${r.type}</td>
        <td data-label="Due" style="padding:8px 12px">${r.dueDate}</td>
        <td data-label="Days" style="padding:8px 12px;color:${rowColor(r.days)};font-weight:600;text-align:right">${r.days}d</td>
      </tr>`).join("");

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; font-size:14px; color:#111827; margin:0; padding:0; background:#f3f4f6; }
  .wrap { max-width:700px; margin:0 auto; padding:32px 24px; background:#ffffff; }
  table { width:100%; border-collapse:collapse; border:1px solid #e5e7eb; border-radius:8px; overflow:hidden; }
  th, td { padding:10px 12px; text-align:left; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#6b7280; background:#f9fafb; }
  @media only screen and (max-width: 600px) {
    .wrap { padding:20px 12px; }
    table, thead, tbody, th, td, tr { display:block; }
    thead { display:none; }
    tr { border:1px solid #e5e7eb; border-radius:6px; padding:10px; margin-bottom:10px; }
    td { border:none !important; padding:4px 0; text-align:left !important; font-size:13px; }
    td:before { content: attr(data-label) ": "; font-weight:600; color:#6b7280; text-transform:uppercase; font-size:11px; letter-spacing:.05em; }
  }
</style>
</head><body>
<div class="wrap">
${logoUrl ? `<div style="margin:0 0 12px"><img src="${logoUrl}" alt="${orgName}" style="max-height:48px;max-width:180px;object-fit:contain;display:block"></div>` : ""}
<h2 style="margin:0 0 4px">${orgName} — Weekly Due Report</h2>
<p style="margin:0 0 24px;color:#6b7280">${today}</p>
<table>
  <thead>
    <tr>
      <th>Customer</th>
      <th>Vehicle</th>
      <th>Reg</th>
      <th>Type</th>
      <th>Due</th>
      <th style="text-align:right">Days</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">Sent every Monday via AI Garage. Showing MOT and service due within ${windowDays} days.</p>
</div>
</body></html>`;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !safeEqual(authHeader, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filterLocationId = searchParams.get("location_id");

  const admin = createAdminClient();
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS_DEFAULT);
  const windowEndStr = windowEnd.toISOString().split("T")[0];
  const todayStr = now.toISOString().split("T")[0];

  let locQuery = admin
    .from("locations")
    .select("id, name, organization:organizations(id, name, logo_url)");
  if (filterLocationId) locQuery = locQuery.eq("id", filterLocationId);

  const { data: locations } = (await locQuery) as { data: LocationRow[] | null };

  const results = { digests: 0, errors: [] as string[] };

  // Group locations by org to send one digest per org
  type OrgEntry = { org: { id: string; name: string; logo_url: string | null }; locationIds: string[]; locationNames: string[]; locationConfigs: { enabled: boolean; window_days: number }[] };
  const orgMap = new Map<string, OrgEntry>();

  for (const location of locations ?? []) {
    if (!location.organization) continue;
    const orgId = location.organization.id;
    if (!orgMap.has(orgId)) {
      orgMap.set(orgId, { org: location.organization, locationIds: [], locationNames: [], locationConfigs: [] });
    }
    const entry = orgMap.get(orgId)!;
    const cfg = await getTaskConfig(admin, location.id);
    entry.locationIds.push(location.id);
    entry.locationNames.push(location.name);
    entry.locationConfigs.push(cfg);
  }

  for (const { org, locationIds, locationConfigs } of orgMap.values()) {
    const anyEnabled = locationConfigs.some((c) => c.enabled);
    if (!anyEnabled) continue;
    const WINDOW_DAYS = Math.max(...locationConfigs.filter((c) => c.enabled).map((c) => c.window_days));
    // Get org owner/admin user IDs
    const { data: orgUsers } = await admin
      .from("org_users")
      .select("user_id")
      .eq("organization_id", org.id);

    if (!orgUsers?.length) continue;

    // Resolve emails via auth admin
    const staffEmails: string[] = [];
    for (const { user_id } of orgUsers) {
      const { data } = await admin.auth.admin.getUserById(user_id);
      if (data.user?.email) staffEmails.push(data.user.email);
    }
    if (!staffEmails.length) continue;

    // Fetch due vehicles across all locations in this org
    const { data: vehicles } = (await admin
      .from("vehicles")
      .select("id, registration, make, model, year, mot_expiry, service_due, customer:customers(full_name, email)")
      .in("location_id", locationIds)
      .or(`mot_expiry.lte.${windowEndStr},service_due.lte.${windowEndStr}`)
      .gt("mot_expiry", todayStr)
      .limit(200)) as { data: VehicleRow[] | null };

    if (!vehicles?.length) continue;

    // Build rows
    type DigestRow = { customerName: string; vehicle: string; registration: string; type: string; dueDate: string; days: number };
    const rows: DigestRow[] = [];

    for (const v of vehicles) {
      const customerName = v.customer?.full_name ?? "Unknown";
      const vehicle = [v.year, v.make, v.model].filter(Boolean).join(" ") || v.registration;

      for (const type of ["mot", "service"] as const) {
        const dueDate = type === "mot" ? v.mot_expiry : v.service_due;
        if (!dueDate) continue;
        const days = daysUntil(dueDate);
        if (days < 0 || days > WINDOW_DAYS) continue;
        rows.push({
          customerName,
          vehicle,
          registration: v.registration,
          type: type === "mot" ? "MOT" : "Service",
          dueDate: new Date(dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
          days,
        });
      }
    }

    if (!rows.length) continue;

    const subject = `${org.name} — ${rows.length} vehicle${rows.length !== 1 ? "s" : ""} due in the next ${WINDOW_DAYS} days`;
    const html = buildDigestHtml(org.name, rows, WINDOW_DAYS, org.logo_url);
    const text = `Weekly due report for ${org.name}. ${rows.length} vehicles due within ${WINDOW_DAYS} days.`;

    for (const email of staffEmails) {
      const result = await sendEmail({ to: email, subject, text, html });
      if (!result.success) {
        results.errors.push(`${email}: ${result.error}`);
      } else {
        results.digests++;
      }
    }
  }

  console.log("[cron/digest]", results);
  return NextResponse.json({ success: true, ...results });
}
