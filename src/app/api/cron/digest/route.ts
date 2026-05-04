import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";

// Runs every Monday at 08:00 UTC via Vercel Cron.
// Sends a weekly MOT/service due report to org owners and admins.
export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOW_DAYS = 30;

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
  organization: { id: string; name: string } | null;
};

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function rowColor(days: number): string {
  if (days <= 7) return "#dc2626";
  if (days <= 14) return "#d97706";
  return "#374151";
}

function buildDigestHtml(orgName: string, rows: { customerName: string; vehicle: string; registration: string; type: string; dueDate: string; days: number }[]): string {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const tableRows = rows
    .sort((a, b) => a.days - b.days)
    .map((r) => `
      <tr style="border-top:1px solid #e5e7eb">
        <td style="padding:8px 12px;color:${rowColor(r.days)};font-weight:${r.days <= 7 ? "600" : "400"}">${r.days <= 7 ? "⚠️ " : ""}${r.customerName}</td>
        <td style="padding:8px 12px;color:#6b7280">${r.vehicle}</td>
        <td style="padding:8px 12px;font-family:monospace">${r.registration}</td>
        <td style="padding:8px 12px;text-transform:uppercase;font-size:12px;font-weight:600">${r.type}</td>
        <td style="padding:8px 12px">${r.dueDate}</td>
        <td style="padding:8px 12px;color:${rowColor(r.days)};font-weight:600;text-align:right">${r.days}d</td>
      </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#111827;max-width:700px;margin:0 auto;padding:32px 24px">
<h2 style="margin:0 0 4px">${orgName} — Weekly Due Report</h2>
<p style="margin:0 0 24px;color:#6b7280">${today}</p>
<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
  <thead>
    <tr style="background:#f9fafb">
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Customer</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Vehicle</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Reg</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Type</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Due</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Days</th>
    </tr>
  </thead>
  <tbody>${tableRows}</tbody>
</table>
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">Sent every Monday via Garage AI. Showing MOT and service due within ${WINDOW_DAYS} days.</p>
</body></html>`;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);
  const windowEndStr = windowEnd.toISOString().split("T")[0];
  const todayStr = now.toISOString().split("T")[0];

  const { data: locations } = (await admin
    .from("locations")
    .select("id, name, organization:organizations(id, name)")) as { data: LocationRow[] | null };

  const results = { digests: 0, errors: [] as string[] };

  // Group locations by org to send one digest per org
  const orgMap = new Map<string, { org: { id: string; name: string }; locationIds: string[]; locationNames: string[] }>();

  for (const location of locations ?? []) {
    if (!location.organization) continue;
    const orgId = location.organization.id;
    if (!orgMap.has(orgId)) {
      orgMap.set(orgId, { org: location.organization, locationIds: [], locationNames: [] });
    }
    const entry = orgMap.get(orgId)!;
    entry.locationIds.push(location.id);
    entry.locationNames.push(location.name);
  }

  for (const { org, locationIds } of orgMap.values()) {
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
    const html = buildDigestHtml(org.name, rows);
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
