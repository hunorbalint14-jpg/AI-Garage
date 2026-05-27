"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { type Permissions, normalisePermissions } from "@/app/staff/staff-members/constants";

export type RoleTemplateRow = {
  id: string;
  organization_id: string | null;
  key: string;
  label: string;
  description: string | null;
  permissions: Permissions;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

function slugifyKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);
}

function parsePermissionsFromForm(formData: FormData): Permissions {
  const keys: (keyof Permissions)[] = [
    "bookings","customers","reminders","fleet","products","notifications",
    "revenue","invoices","reports",
    "quotes_draft","quotes_send","quotes_approve_view",
    "services","bays","automations","campaigns","org_settings",
    "staff_manage","audit_log","gdpr_actions","stripe_connect","xero_integration",
    "mot_records",
  ];
  const out: Partial<Permissions> = {};
  for (const k of keys) out[k] = formData.get(`perm_${k}`) === "on";
  return normalisePermissions(out);
}

function diffPermissions(prev: Permissions, next: Permissions): Record<string, [boolean, boolean]> {
  const diff: Record<string, [boolean, boolean]> = {};
  for (const k of Object.keys(next) as (keyof Permissions)[]) {
    if (prev[k] !== next[k]) diff[k] = [prev[k], next[k]];
  }
  return diff;
}

export async function createRoleTemplate(formData: FormData): Promise<Result<{ id: string }>> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { ok: false, error: "Owner or admin only." };
  }

  const labelRaw = (formData.get("label") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() || null;
  if (!labelRaw) return { ok: false, error: "Label is required." };
  const key = slugifyKey(labelRaw);
  if (!key) return { ok: false, error: "Label must contain at least one alphanumeric character." };

  const permissions = parsePermissionsFromForm(formData);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("role_templates")
    .insert({
      organization_id: ctx.organization.id,
      key,
      label: labelRaw,
      description,
      permissions: permissions as unknown as Record<string, unknown>,
      is_system: false,
      created_by: ctx.user.id,
      sort_order: 1000,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, error: "A template with that name already exists." };
    return { ok: false, error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "role_template.create",
    entityType: "role_template",
    entityId: data.id,
    metadata: { key, label: labelRaw, permissions: permissions as unknown as Record<string, unknown> },
  });

  revalidatePath("/staff/settings/team-roles");
  revalidatePath("/staff/staff-members");
  return { ok: true, data: { id: data.id } };
}

export async function updateRoleTemplate(id: string, formData: FormData): Promise<Result> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { ok: false, error: "Owner or admin only." };
  }

  const labelRaw = (formData.get("label") as string | null)?.trim() ?? "";
  const description = (formData.get("description") as string | null)?.trim() || null;
  if (!labelRaw) return { ok: false, error: "Label is required." };
  const nextPerms = parsePermissionsFromForm(formData);

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("role_templates")
    .select("id, organization_id, is_system, key, label, permissions")
    .eq("id", id)
    .maybeSingle();
  const row = existing as
    | { id: string; organization_id: string | null; is_system: boolean; key: string; label: string; permissions: Partial<Permissions> | null }
    | null;
  if (!row) return { ok: false, error: "Template not found." };
  if (row.is_system) return { ok: false, error: "System templates cannot be edited." };
  if (row.organization_id !== ctx.organization.id) return { ok: false, error: "Not your template." };

  const { error } = await admin
    .from("role_templates")
    .update({
      label: labelRaw,
      description,
      permissions: nextPerms as unknown as Record<string, unknown>,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "role_template.update",
    entityType: "role_template",
    entityId: id,
    metadata: {
      key: row.key,
      label: labelRaw,
      diff: diffPermissions(normalisePermissions(row.permissions), nextPerms),
    },
  });

  revalidatePath("/staff/settings/team-roles");
  revalidatePath("/staff/staff-members");
  return { ok: true };
}

export async function deleteRoleTemplate(id: string): Promise<Result> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { ok: false, error: "Owner or admin only." };
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("role_templates")
    .select("id, organization_id, is_system, key, label")
    .eq("id", id)
    .maybeSingle();
  const row = existing as
    | { id: string; organization_id: string | null; is_system: boolean; key: string; label: string }
    | null;
  if (!row) return { ok: false, error: "Template not found." };
  if (row.is_system) return { ok: false, error: "System templates cannot be deleted." };
  if (row.organization_id !== ctx.organization.id) return { ok: false, error: "Not your template." };

  const { error } = await admin.from("role_templates").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "role_template.delete",
    entityType: "role_template",
    entityId: id,
    metadata: { key: row.key, label: row.label },
  });

  revalidatePath("/staff/settings/team-roles");
  revalidatePath("/staff/staff-members");
  return { ok: true };
}

export async function cloneRoleTemplate(sourceId: string, newLabel: string): Promise<Result<{ id: string }>> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { ok: false, error: "Owner or admin only." };
  }

  const trimmed = newLabel.trim();
  if (!trimmed) return { ok: false, error: "Label is required." };
  const key = slugifyKey(trimmed);
  if (!key) return { ok: false, error: "Label must contain at least one alphanumeric character." };

  const admin = createAdminClient();
  const { data: source } = await admin
    .from("role_templates")
    .select("permissions, description")
    .eq("id", sourceId)
    .maybeSingle();
  const src = source as { permissions: Partial<Permissions> | null; description: string | null } | null;
  if (!src) return { ok: false, error: "Source template not found." };

  const { data, error } = await admin
    .from("role_templates")
    .insert({
      organization_id: ctx.organization.id,
      key,
      label: trimmed,
      description: src.description,
      permissions: normalisePermissions(src.permissions) as unknown as Record<string, unknown>,
      is_system: false,
      created_by: ctx.user.id,
      sort_order: 1000,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { ok: false, error: "A template with that name already exists." };
    return { ok: false, error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "role_template.create",
    entityType: "role_template",
    entityId: data.id,
    metadata: { key, label: trimmed, cloned_from: sourceId },
  });

  revalidatePath("/staff/settings/team-roles");
  return { ok: true, data: { id: data.id } };
}
