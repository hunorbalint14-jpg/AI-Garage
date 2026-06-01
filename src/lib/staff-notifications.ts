import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type StaffNotificationKind =
  | "quote.approved"
  | "quote.declined"
  | "quote.rebooked"
  | "quote.deposit_paid"
  | "review.low_score";

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

// Used by the staff layout/badge — counts unread notifications scoped to the
// current location. RLS handles the tenant filter via is_location_member.
export async function unreadNotificationCount(locationId: string): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("staff_notifications")
      .select("id", { count: "exact", head: true })
      .eq("location_id", locationId)
      .is("read_at", null);
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listRecentNotifications(
  locationId: string,
  limit = 20,
): Promise<StaffNotification[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("staff_notifications")
      .select(
        "id, user_id, location_id, organization_id, kind, title, body, href, entity_type, entity_id, read_at, created_at",
      )
      .eq("location_id", locationId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as StaffNotification[];
  } catch {
    return [];
  }
}
