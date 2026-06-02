import { createAdminClient } from "@/lib/supabase/admin";

// Staff who can be assigned work at a location: org-level members (owners +
// admins, who span every location) plus this location's direct members. Display
// names come from the auth user's metadata (same source as staff-context).
// Used for the technician assignment dropdown + to resolve assignee names for
// display. Small staff counts, so the per-user auth lookup is fine.

export type StaffMember = { id: string; name: string; email: string | null };

export async function listLocationStaff(locationId: string, organizationId: string): Promise<StaffMember[]> {
  const admin = createAdminClient();

  const [orgRes, locRes] = await Promise.all([
    admin.from("org_users").select("user_id").eq("organization_id", organizationId),
    admin.from("location_users").select("user_id").eq("location_id", locationId),
  ]);

  const ids = [
    ...new Set([
      ...((orgRes.data ?? []) as { user_id: string }[]).map((u) => u.user_id),
      ...((locRes.data ?? []) as { user_id: string }[]).map((u) => u.user_id),
    ]),
  ];

  const members: StaffMember[] = [];
  for (const id of ids) {
    const { data } = await admin.auth.admin.getUserById(id);
    const u = data?.user;
    if (!u) continue;
    const name = (u.user_metadata?.full_name as string | undefined)?.trim() || u.email || "Staff";
    members.push({ id, name, email: u.email ?? null });
  }

  members.sort((a, b) => a.name.localeCompare(b.name));
  return members;
}

// Convenience: a id→name map for resolving assignees when rendering lists.
export async function staffNameMap(locationId: string, organizationId: string): Promise<Map<string, string>> {
  const staff = await listLocationStaff(locationId, organizationId);
  return new Map(staff.map((s) => [s.id, s.name]));
}
