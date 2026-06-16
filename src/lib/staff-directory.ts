import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

// Staff who can be assigned work at a location: org-level members (owners +
// admins, who span every location) plus this location's direct members. Display
// names come from the auth user's metadata (same source as staff-context).
// Used for the technician assignment dropdown + to resolve assignee names for
// display.

export type StaffMember = { id: string; name: string; email: string | null };

async function fetchLocationStaff(locationId: string, organizationId: string): Promise<StaffMember[]> {
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

  // Resolve display names in parallel — this was a sequential per-user auth
  // round-trip loop (N+1), the slowest part of any page that lists staff.
  const settled = await Promise.all(ids.map((id) => admin.auth.admin.getUserById(id)));
  const members: StaffMember[] = [];
  settled.forEach((res, i) => {
    const u = res.data?.user;
    if (!u) return;
    const name = (u.user_metadata?.full_name as string | undefined)?.trim() || u.email || "Staff";
    members.push({ id: ids[i], name, email: u.email ?? null });
  });

  members.sort((a, b) => a.name.localeCompare(b.name));
  return members;
}

// The roster changes rarely (staff added/removed/renamed) but is read on every
// jobs/bookings/assignment view, so cache it off the per-navigation hot path.
// Time-based 60s revalidate keeps it simple (no invalidation-site hunting); the
// tag lets a future staff-mutation path bust it on demand. No cookies/headers
// inside — all inputs are passed as args — so it's safe under `unstable_cache`.
export async function listLocationStaff(locationId: string, organizationId: string): Promise<StaffMember[]> {
  return unstable_cache(
    () => fetchLocationStaff(locationId, organizationId),
    ["location-staff", locationId, organizationId],
    { revalidate: 60, tags: [`location-staff:${locationId}`] },
  )();
}

// Convenience: a id→name map for resolving assignees when rendering lists.
export async function staffNameMap(locationId: string, organizationId: string): Promise<Map<string, string>> {
  const staff = await listLocationStaff(locationId, organizationId);
  return new Map(staff.map((s) => [s.id, s.name]));
}
