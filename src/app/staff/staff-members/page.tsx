import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { StaffManager } from "./staff-manager";
import { type Permissions, DEFAULT_PERMS } from "./constants";

export type StaffEntry = {
  userId: string;
  email: string;
  fullName: string | null;
  lastSignIn: string | null;
  isCurrentUser: boolean;
  hasMfa: boolean;
  orgRole: "owner" | "admin" | null;
  locationEntries: {
    locationId: string;
    locationName: string;
    role: string;
    permissions: Permissions;
  }[];
};

export type LocationOption = {
  id: string;
  name: string;
  slug: string;
};


export default async function StaffMembersPage() {
  const ctx = await requireStaffContext();

  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Team" description="Staff management is restricted to owners and admins." />
      </div>
    );
  }

  const admin = createAdminClient();

  const [orgUsersRes, locationsRes] = await Promise.all([
    admin
      .from("org_users")
      .select("user_id, role")
      .eq("organization_id", ctx.organization.id),
    admin
      .from("locations")
      .select("id, name, slug")
      .eq("organization_id", ctx.organization.id)
      .order("created_at", { ascending: true }),
  ]);

  const locations = (locationsRes.data ?? []) as LocationOption[];
  const locationIds = locations.map((l) => l.id);

  const locationUsersRes = locationIds.length
    ? await admin
        .from("location_users")
        .select("user_id, location_id, role, permissions")
        .in("location_id", locationIds)
    : { data: [] };

  const locationUsers = (locationUsersRes.data ?? []) as {
    user_id: string;
    location_id: string;
    role: string;
    permissions: Permissions | null;
  }[];

  const orgUsers = (orgUsersRes.data ?? []) as { user_id: string; role: string }[];

  // Collect all unique user IDs
  const allUserIds = [
    ...new Set([
      ...orgUsers.map((u) => u.user_id),
      ...locationUsers.map((u) => u.user_id),
    ]),
  ];

  // Fetch auth user details
  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userMap = new Map(authUsers.map((u) => [u.id, u]));

  // Build StaffEntry list
  const entriesMap = new Map<string, StaffEntry>();

  for (const userId of allUserIds) {
    const authUser = userMap.get(userId);
    if (!authUser) continue;

    const orgUser = orgUsers.find((u) => u.user_id === userId);
    const locEntries = locationUsers
      .filter((u) => u.user_id === userId)
      .map((u) => ({
        locationId: u.location_id,
        locationName: locations.find((l) => l.id === u.location_id)?.name ?? "Unknown",
        role: u.role,
        permissions: u.permissions ?? DEFAULT_PERMS,
      }));

    entriesMap.set(userId, {
      userId,
      email: authUser.email ?? "",
      fullName: (authUser.user_metadata?.full_name as string | null) ?? null,
      lastSignIn: authUser.last_sign_in_at ?? null,
      isCurrentUser: userId === ctx.user.id,
      hasMfa: (authUser.factors ?? []).filter((f: { status: string }) => f.status === "verified").length > 0,
      orgRole: orgUser ? (orgUser.role as "owner" | "admin") : null,
      locationEntries: locEntries,
    });
  }

  // Sort: owner first, then admins, then by name
  const entries = [...entriesMap.values()].sort((a, b) => {
    if (a.orgRole === "owner") return -1;
    if (b.orgRole === "owner") return 1;
    if (a.orgRole === "admin" && b.orgRole !== "admin") return -1;
    if (b.orgRole === "admin" && a.orgRole !== "admin") return 1;
    return (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email);
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Invite staff, set permissions, and control location access."
      />
      <StaffManager
        entries={entries}
        locations={locations}
        currentUserId={ctx.user.id}
        isOwner={ctx.orgRole === "owner"}
      />
    </div>
  );
}
