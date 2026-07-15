import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { StaffContext } from "@/lib/staff-context";
import {
  parseWeeklyHours,
  formatWeeklySummary,
  formatDayHours,
  resolveHoursForDate,
  type SpecialHours,
} from "@/lib/business-hours";
import { canUseTool, type AssistToolName, type AssistRoleInfo } from "@/lib/support-assist";
import { shortTicketRef, STATUS_LABELS } from "@/lib/support-tickets-shared";
import { getConnectionStatus } from "@/lib/accounting/connection";
import { PROVIDER_LABELS } from "@/lib/accounting/types";

// Read-only org-data tools for the support widget's assistant. Every executor
// runs on the caller's RLS-scoped client (ctx.supabase) so the database is a
// second gate behind canUseTool(); results are compact plain text (they land
// in the model's context). Failures return a message, never throw — a broken
// tool must not kill the answer.

export const ASSIST_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_opening_hours",
    description:
      "Opening hours for the staff member's active branch. Call when the question is about THIS garage's own opening times, including a specific date (holidays, overrides).",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Optional ISO date (YYYY-MM-DD) to resolve a single day incl. special-day overrides.",
        },
      },
    },
  },
  {
    name: "list_branches",
    description:
      "Branches (locations) of this organisation with addresses. Call for questions about the garage's own sites, or which branch is active.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_services",
    description:
      "Active bookable services at the active branch with price and duration. Call for questions about this garage's own service list or pricing.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_todays_snapshot",
    description:
      "Today's live counts at the active branch: bookings today and open jobs. Call for questions about the current workload.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_integration_status",
    description:
      "Whether Stripe (card payments) and an accounting provider (Xero or QuickBooks) are connected for this organisation. Owner/admin only. Call when troubleshooting payments or accounting sync.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_team_overview",
    description:
      "Team size and roles across the organisation's branches. Owner/admin only.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_past_tickets",
    description:
      "Search this organisation's own past support tickets (resolved/answered) for a similar question and what the AI Garage team replied.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords to search subjects and bodies for." },
      },
      required: ["query"],
    },
  },
];

const NOT_PERMITTED =
  "Not available: the signed-in staff member's role does not have access to this information. Answer without it, and say an owner or admin can check.";

function roleInfo(ctx: StaffContext): AssistRoleInfo {
  return {
    orgRole: ctx.orgRole,
    // Accountants carry a null locationRole and no operational reach.
    isLocationMember: ctx.locationRole !== null,
  };
}

export async function executeAssistTool(
  ctx: StaffContext,
  name: string,
  input: unknown,
): Promise<string> {
  const tool = name as AssistToolName;
  if (!canUseTool(tool, roleInfo(ctx))) return NOT_PERMITTED;

  try {
    switch (tool) {
      case "get_opening_hours":
        return await getOpeningHours(ctx, input);
      case "list_branches":
        return await listBranches(ctx);
      case "list_services":
        return await listServices(ctx);
      case "get_todays_snapshot":
        return await getTodaysSnapshot(ctx);
      case "get_integration_status":
        return await getIntegrationStatus(ctx);
      case "get_team_overview":
        return await getTeamOverview(ctx);
      case "search_past_tickets":
        return await searchPastTickets(ctx, input);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    console.error(`[support-assist] tool ${name} failed`, err);
    return "This lookup failed — answer without it and suggest checking the relevant page.";
  }
}

async function getOpeningHours(ctx: StaffContext, input: unknown): Promise<string> {
  const { data: loc } = await ctx.supabase
    .from("locations")
    .select("name, business_hours")
    .eq("id", ctx.location.id)
    .maybeSingle();
  if (!loc) return "Could not read the active branch's hours.";
  const weekly = parseWeeklyHours(loc.business_hours);

  const date = typeof (input as { date?: unknown })?.date === "string"
    ? ((input as { date: string }).date).slice(0, 10)
    : null;

  const lines = [`Branch: ${loc.name}`, `Weekly hours: ${formatWeeklySummary(weekly)}`];

  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const { data: specials } = await ctx.supabase
      .from("location_special_hours")
      .select("date, is_closed, open_minute, close_minute")
      .eq("location_id", ctx.location.id)
      .eq("date", date);
    const exceptions: SpecialHours[] = (specials ?? []).map((s) => ({
      date: s.date as string,
      isClosed: s.is_closed as boolean,
      openMinute: s.open_minute as number | null,
      closeMinute: s.close_minute as number | null,
    }));
    const resolved = resolveHoursForDate(weekly, exceptions, date);
    lines.push(
      `On ${date}: ${resolved.open && resolved.hours ? `open ${formatDayHours(resolved.hours)}` : "closed"}${exceptions.length ? " (special-day override applies)" : ""}`,
    );
  }
  return lines.join("\n");
}

async function listBranches(ctx: StaffContext): Promise<string> {
  const { data } = await ctx.supabase
    .from("locations")
    .select("name, address")
    .eq("organization_id", ctx.organization.id)
    .order("name");
  if (!data?.length) return "No branches visible to this staff member.";
  const rows = data.map(
    (l) => `- ${l.name}${l.name === ctx.location.name ? " (active branch)" : ""}${l.address ? ` — ${l.address}` : ""}`,
  );
  return `Branches of ${ctx.organization.name}:\n${rows.join("\n")}`;
}

async function listServices(ctx: StaffContext): Promise<string> {
  const { data } = await ctx.supabase
    .from("services")
    .select("name, price, duration_minutes, category")
    .eq("location_id", ctx.location.id)
    .eq("active", true)
    .order("category")
    .order("name")
    .limit(40);
  if (!data?.length) return "No active services configured at the active branch.";
  const rows = data.map(
    (s) =>
      `- ${s.name}${s.category ? ` [${s.category}]` : ""}: £${Number(s.price).toFixed(2)}, ${s.duration_minutes} min`,
  );
  return `Active services at ${ctx.location.name} (up to 40 shown):\n${rows.join("\n")}`;
}

async function getTodaysSnapshot(ctx: StaffContext): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const [bookings, jobs] = await Promise.all([
    ctx.supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .gte("scheduled_at", `${today}T00:00:00`)
      .lt("scheduled_at", `${today}T23:59:59`),
    ctx.supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("location_id", ctx.location.id)
      .eq("status", "open"),
  ]);
  return `Today at ${ctx.location.name}: ${bookings.count ?? 0} booking(s) today, ${jobs.count ?? 0} open job(s).`;
}

async function getIntegrationStatus(ctx: StaffContext): Promise<string> {
  const [{ data }, accounting] = await Promise.all([
    ctx.supabase
      .from("organizations")
      .select("stripe_account_id, stripe_charges_enabled")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
    // Connections table is service-role only (it holds tokens); this
    // helper returns only provider + display name.
    getConnectionStatus(ctx.organization.id),
  ]);
  if (!data) return "Could not read integration status.";
  const stripe = data.stripe_account_id
    ? data.stripe_charges_enabled
      ? "connected, charges enabled"
      : "connected, but charges NOT yet enabled (finish Stripe onboarding)"
    : "not connected";
  const books = accounting
    ? `${PROVIDER_LABELS[accounting.provider]} connected${accounting.displayName ? ` (${accounting.displayName})` : ""}`
    : "not connected";
  return `Stripe: ${stripe}\nAccounting: ${books}`;
}

async function getTeamOverview(ctx: StaffContext): Promise<string> {
  const [locStaff, orgStaff] = await Promise.all([
    // Hint the locations join through location_id — locations has multiple
    // FK paths from location_users tables in this schema family; unhinted
    // embeds break with PGRST201 when a second FK appears.
    ctx.supabase
      .from("location_users")
      .select("role, locations!location_id(name)")
      .limit(200),
    ctx.supabase
      .from("org_users")
      .select("role")
      .eq("organization_id", ctx.organization.id)
      .limit(50),
  ]);
  const byBranch = new Map<string, string[]>();
  for (const row of locStaff.data ?? []) {
    const branch = (row.locations as { name?: string } | null)?.name ?? "(unknown branch)";
    const list = byBranch.get(branch) ?? [];
    list.push(row.role as string);
    byBranch.set(branch, list);
  }
  const lines = [...byBranch.entries()].map(
    ([branch, roles]) => `- ${branch}: ${roles.length} member(s) (${summariseRoles(roles)})`,
  );
  const orgRoles = (orgStaff.data ?? []).map((r) => r.role as string);
  const header = orgRoles.length
    ? `Org-level: ${summariseRoles(orgRoles)}`
    : "Org-level: none visible";
  if (!lines.length && !orgRoles.length) return "No team members visible.";
  return `${header}\nTeam by branch:\n${lines.join("\n") || "- (none)"}`;
}

function summariseRoles(roles: string[]): string {
  const counts = new Map<string, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].map(([r, n]) => `${n}× ${r}`).join(", ");
}

async function searchPastTickets(ctx: StaffContext, input: unknown): Promise<string> {
  const query = typeof (input as { query?: unknown })?.query === "string"
    ? (input as { query: string }).query.trim().slice(0, 120)
    : "";
  if (!query) return "No search terms given.";

  // Keyword OR-match on subject via the caller's RLS-scoped client (org
  // tickets only, internal notes invisible by policy).
  const terms = query.split(/\s+/).filter((t) => t.length >= 3).slice(0, 5);
  if (terms.length === 0) return "Search terms too short.";
  const orFilter = terms.map((t) => `subject.ilike.%${t.replace(/[%,()]/g, "")}%`).join(",");

  const { data: tickets } = await ctx.supabase
    .from("support_tickets")
    .select("id, subject, status, created_at")
    .eq("organization_id", ctx.organization.id)
    .or(orFilter)
    .order("last_activity_at", { ascending: false })
    .limit(3);
  if (!tickets?.length) return "No similar past tickets found for this organisation.";

  const out: string[] = [];
  for (const t of tickets) {
    const { data: reply } = await ctx.supabase
      .from("support_ticket_messages")
      .select("body")
      .eq("ticket_id", t.id)
      .eq("author_kind", "platform_admin")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    out.push(
      `${shortTicketRef(t.id)} "${t.subject}" (${STATUS_LABELS[t.status as keyof typeof STATUS_LABELS] ?? t.status})${reply ? ` — team replied: ${(reply.body as string).slice(0, 300)}` : " — no team reply yet"}`,
    );
  }
  return `Similar past tickets from this organisation:\n${out.join("\n")}`;
}
