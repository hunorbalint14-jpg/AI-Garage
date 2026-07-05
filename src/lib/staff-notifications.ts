import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StaffNotificationKind =
  | "quote.approved"
  | "quote.declined"
  | "quote.rebooked"
  | "quote.deposit_paid"
  | "review.low_score"
  | "receptionist.booking"
  | "receptionist.handoff"
  | "ticket.reply"
  | "ticket.status";

export type StaffNotification = {
  id: string;
  user_id: string | null;
  location_id: string;
  organization_id: string | null;
  kind: StaffNotificationKind;
  title: string;
  body: string | null;
  href: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type CreateStaffNotificationInput = {
  userId: string | null;
  locationId: string;
  organizationId: string | null;
  kind: StaffNotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

// Fire-and-forget. Server actions call this from cron/webhook contexts so
// failures here must never break the caller — log to stderr and continue.
export async function createStaffNotification(input: CreateStaffNotificationInput): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("staff_notifications").insert({
      user_id: input.userId,
      location_id: input.locationId,
      organization_id: input.organizationId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
    });
  } catch (err) {
    console.error("[staff-notifications] insert failed", err);
  }
}

// Ticket notifications are owned by the support widget's badge + peek toast;
// the bell passes these as excludeKinds so replies aren't double-badged. The
// /staff/notifications archive keeps the complete history (no exclusion).
export const TICKET_NOTIFICATION_KINDS = ["ticket.reply", "ticket.status"] as const;

type NotificationQueryOpts = { excludeKinds?: readonly string[] };

function kindExclusionFilter(kinds: readonly string[]): string {
  return `(${kinds.join(",")})`;
}

// Used by the staff layout/badge — counts unread notifications scoped to the
// current location. RLS handles the tenant filter via is_location_member.
export async function unreadNotificationCount(
  locationId: string,
  opts: NotificationQueryOpts = {},
): Promise<number> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("staff_notifications")
      .select("id", { count: "exact", head: true })
      .eq("location_id", locationId)
      .is("read_at", null);
    if (opts.excludeKinds?.length) {
      query = query.not("kind", "in", kindExclusionFilter(opts.excludeKinds));
    }
    const { count } = await query;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listRecentNotifications(
  locationId: string,
  limit = 20,
  opts: NotificationQueryOpts = {},
): Promise<StaffNotification[]> {
  try {
    const supabase = await createClient();
    let query = supabase
      .from("staff_notifications")
      .select(
        "id, user_id, location_id, organization_id, kind, title, body, href, entity_type, entity_id, read_at, created_at",
      )
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (opts.excludeKinds?.length) {
      query = query.not("kind", "in", kindExclusionFilter(opts.excludeKinds));
    }
    const { data } = await query;
    return (data ?? []) as StaffNotification[];
  } catch {
    return [];
  }
}

// Widget badge: the user's own unread ticket notifications. Deliberately no
// location filter — ticket notifications are targeted (user_id = requester)
// and tickets are org-scoped, so the badge survives branch switches; RLS
// remains the tenant backstop.
export async function countUnreadTicketNotifications(userId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("staff_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("kind", [...TICKET_NOTIFICATION_KINDS])
      .is("read_at", null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export type UnreadTicketReply = {
  id: string;
  ticketId: string;
  snippet: string;
  createdAt: string;
};

// Peek toast source: the newest unread admin reply targeted at this user.
export async function latestUnreadTicketReply(userId: string): Promise<UnreadTicketReply | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("staff_notifications")
      .select("id, entity_id, title, body, created_at")
      .eq("user_id", userId)
      .eq("kind", "ticket.reply")
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data?.entity_id) return null;
    return {
      id: data.id,
      ticketId: data.entity_id,
      snippet: data.body ?? data.title,
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}
