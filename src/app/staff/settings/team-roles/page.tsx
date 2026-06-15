import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/staff/page-header";
import { type Permissions, normalisePermissions } from "@/app/staff/staff-members/constants";
import { TemplateEditor } from "./template-editor";


type RoleTemplate = {
  id: string;
  organization_id: string | null;
  key: string;
  label: string;
  description: string | null;
  permissions: Permissions;
  is_system: boolean;
  sort_order: number;
  updated_at: string;
};

export default async function TeamRolesPage() {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") notFound();

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("role_templates")
    .select("id, organization_id, key, label, description, permissions, is_system, sort_order, updated_at")
    .or(`organization_id.is.null,organization_id.eq.${ctx.organization.id}`)
    .order("is_system", { ascending: false })
    .order("sort_order");

  type Raw = Omit<RoleTemplate, "permissions"> & { permissions: Partial<Permissions> | null };
  const templates: RoleTemplate[] = ((rows ?? []) as Raw[]).map((r) => ({
    ...r,
    permissions: normalisePermissions(r.permissions),
  }));

  const systemTemplates = templates.filter((t) => t.is_system);
  const customTemplates = templates.filter((t) => !t.is_system);

  return (
    <div className="flex flex-col gap-4 sm:gap-6 max-w-5xl">
      <div>
        <Link href="/staff/settings" className="text-sm text-muted-foreground underline">
          ← Back to settings
        </Link>
      </div>

      <PageHeader
        title="Team roles"
        description="System templates ship with sensible UK garage defaults. Clone one and tweak it to fit your shop, or create a profile from scratch."
      />

      <TemplateEditor system={systemTemplates} custom={customTemplates} />
    </div>
  );
}
