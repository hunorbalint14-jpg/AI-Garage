import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { DevTools } from "./dev-tools";

export type DevCustomer = {
  id: string;
  fullName: string | null;
  email: string | null;
  hasAuth: boolean;
};

export type DevStaff = {
  userId: string;
  email: string;
  fullName: string | null;
  role: string;
};

export default async function DevPage() {
  const ctx = await requireStaffContext();

  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Dev tools" description="Restricted to owners and admins." />
      </div>
    );
  }

  const admin = createAdminClient();
  const in60 = new Date();
  in60.setDate(in60.getDate() + 60);

  const [customersRes, locationsRes, orgUsersRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, full_name, email, user_id")
      .eq("location_id", ctx.location.id)
      .order("full_name", { ascending: true })
      .limit(200),
    admin
      .from("locations")
      .select("id")
      .eq("organization_id", ctx.organization.id),
    admin
      .from("org_users")
      .select("user_id, role")
      .eq("organization_id", ctx.organization.id),
  ]);

  const locationIds = (locationsRes.data ?? []).map((l: { id: string }) => l.id);
  const locationUsersRes = locationIds.length
    ? await admin
        .from("location_users")
        .select("user_id, role")
        .in("location_id", locationIds)
    : { data: [] };

  const orgUsers = (orgUsersRes.data ?? []) as { user_id: string; role: string }[];
  const locationUsers = (locationUsersRes.data ?? []) as { user_id: string; role: string }[];

  const allStaffIds = [
    ...new Set([...orgUsers.map((u) => u.user_id), ...locationUsers.map((u) => u.user_id)]),
  ];

  const { data: { users: authUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userMap = new Map(authUsers.map((u) => [u.id, u]));

  const staff: DevStaff[] = allStaffIds
    .map((id) => {
      const authUser = userMap.get(id);
      if (!authUser?.email) return null;
      const orgUser = orgUsers.find((u) => u.user_id === id);
      const locUser = locationUsers.find((u) => u.user_id === id);
      return {
        userId: id,
        email: authUser.email,
        fullName: (authUser.user_metadata?.full_name as string | null) ?? null,
        role: orgUser?.role ?? locUser?.role ?? "staff",
      };
    })
    .filter(Boolean) as DevStaff[];

  const customers: DevCustomer[] = ((customersRes.data ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
    user_id: string | null;
  }[]).map((c) => ({
    id: c.id,
    fullName: c.full_name,
    email: c.email,
    hasAuth: !!c.user_id,
  }));

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <PageHeader
        title="Dev tools"
        description="Test the app as any customer or staff member. Owner-only. Links expire in 1 hour."
      />
      <DevTools customers={customers} staff={staff} />
    </div>
  );
}
