"use server";

import { type Permissions, normalisePermissions, PERMISSION_GROUPS } from "./constants";
import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";

export type StaffActionResult = { error: string } | { success: true };
export type InviteResult = { error: string } | { success: true; inviteLink: string };
export type LinkResult = { error: string } | { success: true; link: string };

const ALLOWED_LOCATION_ROLES = [
  "manager",
  "service_advisor",
  "mechanic",
  "apprentice",
  "receptionist",
  "parts",
  "bookkeeper",
  "staff",
];

function readPermsFromForm(formData: FormData): Permissions {
  const obj: Partial<Permissions> = {};
  for (const g of PERMISSION_GROUPS) {
    for (const k of g.keys) obj[k] = formData.get(`perm_${k}`) === "on";
  }
  return normalisePermissions(obj);
}

export async function inviteStaffMember(formData: FormData): Promise<InviteResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    return { error: "Owner or admin only." };
  }

  const email = (formData.get("email") as string | null)?.trim().toLowerCase();
  const fullName = (formData.get("fullName") as string | null)?.trim() || null;
  const scope = (formData.get("scope") as string | null) ?? "location";
  const locationId = (formData.get("locationId") as string | null)?.trim() || null;
  const role = (formData.get("role") as string | null) ?? "staff";
  const templateId = (formData.get("templateId") as string | null)?.trim() || null;
  const motTester = formData.get("mot_tester") === "on";
  const motQcReviewer = formData.get("mot_qc_reviewer") === "on";

  if (!email) return { error: "Email is required." };
  if (scope === "location" && !locationId) return { error: "Select a location." };
  if (scope === "org" && role !== "admin") {
    // Org scope is always admin; auto-coerce.
  }
  if (scope === "location" && !ALLOWED_LOCATION_ROLES.includes(role)) {
    return { error: "Invalid role." };
  }

  const rawPerms = readPermsFromForm(formData);

  const admin = createAdminClient();

  if (scope === "location" && locationId) {
    const { data: loc } = await admin
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle();
    if (!loc) return { error: "Location not found." };
  }

  const { data: orgRes } = await admin
    .from("organizations")
    .select("name")
    .eq("id", ctx.organization.id)
    .maybeSingle();
  const garageName = orgRes?.name ?? ctx.organization.name;

  // Create user with email pre-confirmed, then generate a magic link.
  // This avoids the "otp_expired" issue with invite-type links which require
  // the email to be unconfirmed and are invalidated on each generateLink call.
  let userId: string;

  const { data: { users: existing } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existingUser = existing.find((u) => u.email?.toLowerCase() === email);

  if (existingUser) {
    userId = existingUser.id;
    // Ensure email is confirmed so magiclink works
    if (!existingUser.email_confirmed_at) {
      await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    }
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (createErr) return { error: createErr.message };
    userId = newUser.user.id;
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `http://${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"}`;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${siteUrl}/auth/callback?next=/staff` },
  });
  if (linkErr) return { error: linkErr.message };
  const inviteLink = linkData.properties.action_link;

  // Assign to org or location
  if (scope === "org" || role === "admin") {
    const { error } = await admin.from("org_users").upsert(
      { organization_id: ctx.organization.id, user_id: userId, role: "admin" },
      { onConflict: "organization_id,user_id" },
    );
    if (error) return { error: error.message };
  } else {
    // Validate template (if provided) belongs to this org or is a system row.
    let safeTemplateId: string | null = null;
    if (templateId) {
      const { data: tpl } = await admin
        .from("role_templates")
        .select("id, organization_id, is_system")
        .eq("id", templateId)
        .maybeSingle();
      const row = tpl as { id: string; organization_id: string | null; is_system: boolean } | null;
      if (row && (row.is_system || row.organization_id === ctx.organization.id)) {
        safeTemplateId = row.id;
      }
    }

    const { error } = await admin.from("location_users").upsert(
      {
        location_id: locationId!,
        user_id: userId,
        role,
        permissions: rawPerms as unknown as Record<string, unknown>,
        template_id: safeTemplateId,
        mot_tester: motTester,
        mot_qc_reviewer: motQcReviewer,
      },
      { onConflict: "location_id,user_id" },
    );
    if (error) return { error: error.message };

    if (safeTemplateId) {
      await logAudit({
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email ?? null,
        action: "staff.template_assign",
        entityType: "location_user",
        entityId: userId,
        metadata: { location_id: locationId, template_id: safeTemplateId },
      });
    }
    if (motTester || motQcReviewer) {
      await logAudit({
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email ?? null,
        action: "staff.mot_flag_change",
        entityType: "location_user",
        entityId: userId,
        metadata: { location_id: locationId, mot_tester: motTester, mot_qc_reviewer: motQcReviewer },
      });
    }
  }

  // Send invite email via Resend
  const firstName = fullName?.split(" ")[0] ?? "there";
  await sendEmail({
    to: email,
    subject: `You've been invited to join ${garageName} on AI Garage`,
    text: `Hi ${firstName},\n\n${garageName} has invited you to join their team on AI Garage.\n\nClick the link below to accept your invite and set your password:\n\n${inviteLink}\n\nThis link expires in 24 hours. If you didn't expect this, you can ignore it.\n\nAI Garage`,
  });

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.invite",
    entityType: "auth_user",
    entityId: userId,
    metadata: { invited_email: email, scope, location_id: locationId, role },
  });

  revalidatePath("/staff/staff-members");
  return { success: true, inviteLink };
}

export async function resetStaffPassword(email: string): Promise<LinkResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };

  const admin = createAdminClient();
  const { data: { users: allUsers } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const targetUser = allUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (targetUser && !targetUser.email_confirmed_at) {
    await admin.auth.admin.updateUserById(targetUser.id, { email_confirm: true });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `http://${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"}`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${siteUrl}/auth/callback?next=/staff` },
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.password_reset",
    entityType: "auth_user",
    entityId: targetUser?.id ?? null,
    metadata: { target_email: email },
  });

  return { success: true, link: data.properties.action_link };
}

export async function setStaffPassword(
  userId: string,
  password: string,
): Promise<StaffActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.password_set",
    entityType: "auth_user",
    entityId: userId,
  });

  return { success: true };
}

export async function resetStaffMfa(userId: string): Promise<StaffActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };
  if (userId === ctx.user.id) return { error: "Cannot reset your own MFA here — use your profile settings." };

  const admin = createAdminClient();
  const { data: { user }, error: userErr } = await admin.auth.admin.getUserById(userId);
  if (userErr || !user) return { error: userErr?.message ?? "User not found." };

  const factors = user.factors ?? [];
  for (const factor of factors) {
    await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.mfa_reset",
    entityType: "auth_user",
    entityId: userId,
    metadata: { factor_count: factors.length },
  });

  revalidatePath("/staff/staff-members");
  return { success: true };
}

export async function updateStaffPermissions(
  userId: string,
  locationId: string,
  permissions: Permissions,
): Promise<StaffActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("location_users")
    .update({
      permissions: permissions as unknown as Record<string, unknown>,
      // Inline edits detach from template — store snapshot, drop reference.
      template_id: null,
    })
    .eq("user_id", userId)
    .eq("location_id", locationId);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.permissions_update",
    entityType: "location_user",
    entityId: userId,
    metadata: { location_id: locationId, permissions: permissions as unknown as Record<string, unknown> },
  });

  revalidatePath("/staff/staff-members");
  return { success: true };
}

export async function updateStaffRole(
  userId: string,
  locationId: string,
  role: string,
): Promise<StaffActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };
  if (!ALLOWED_LOCATION_ROLES.includes(role)) return { error: "Invalid role." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("location_users")
    .update({ role })
    .eq("user_id", userId)
    .eq("location_id", locationId);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.role_change",
    entityType: "location_user",
    entityId: userId,
    metadata: { location_id: locationId, new_role: role },
  });

  revalidatePath("/staff/staff-members");
  return { success: true };
}

export async function updateStaffMotFlags(
  userId: string,
  locationId: string,
  motTester: boolean,
  motQcReviewer: boolean,
): Promise<StaffActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("location_users")
    .update({ mot_tester: motTester, mot_qc_reviewer: motQcReviewer })
    .eq("user_id", userId)
    .eq("location_id", locationId);

  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.mot_flag_change",
    entityType: "location_user",
    entityId: userId,
    metadata: { location_id: locationId, mot_tester: motTester, mot_qc_reviewer: motQcReviewer },
  });

  revalidatePath("/staff/staff-members");
  return { success: true };
}

export async function removeStaffMember(
  userId: string,
  locationId: string | null,
): Promise<StaffActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Owner or admin only." };
  if (userId === ctx.user.id) return { error: "Cannot remove yourself." };

  const admin = createAdminClient();

  if (locationId) {
    const { error } = await admin
      .from("location_users")
      .delete()
      .eq("user_id", userId)
      .eq("location_id", locationId);
    if (error) return { error: error.message };
  } else {
    const { error } = await admin
      .from("org_users")
      .delete()
      .eq("user_id", userId)
      .eq("organization_id", ctx.organization.id)
      .neq("role", "owner");
    if (error) return { error: error.message };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.remove",
    entityType: locationId ? "location_user" : "org_user",
    entityId: userId,
    metadata: { location_id: locationId },
  });

  revalidatePath("/staff/staff-members");
  return { success: true };
}
