"use server";

import { type Permissions, normalisePermissions, PERMISSION_GROUPS } from "./constants";
import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";
import { emailSchema, parseOrError } from "@/lib/validation";

export type StaffActionResult = { error: string } | { success: true };
export type InviteResult = { error: string } | { success: true; inviteLink: string };
export type LinkResult = { error: string } | { success: true; link: string };

// Build the URL the magiclink redirects to after auth. Must be a real
// tenant subdomain (so the invited user lands on the right garage's staff
// console) and must be on https in any non-dev environment. Filters out
// the local-dev "localtest.me" value if it leaks into prod env.
function tenantAuthCallbackUrl(slug: string): string {
  const rawRoot = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "";
  const isLocal = !rawRoot || rawRoot.includes("localtest") || rawRoot.includes("localhost");
  if (isLocal) {
    // dev fallback — Supabase redirect URLs allowlist includes localhost.
    const host = rawRoot || "localhost:3000";
    return `http://${slug}.${host}/auth/callback?next=/staff`;
  }
  return `https://${slug}.${rawRoot}/auth/callback?next=/staff`;
}

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

  const emailParsed = parseOrError(emailSchema, formData.get("email"));
  if ("error" in emailParsed) return emailParsed;
  const email = emailParsed.data;

  const fullName = (formData.get("fullName") as string | null)?.trim() || null;
  const scope = (formData.get("scope") as string | null) ?? "location";
  const locationId = (formData.get("locationId") as string | null)?.trim() || null;
  const role = (formData.get("role") as string | null) ?? "staff";
  const templateId = (formData.get("templateId") as string | null)?.trim() || null;
  const motTester = formData.get("mot_tester") === "on";
  const motQcReviewer = formData.get("mot_qc_reviewer") === "on";
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

  // For location-scoped invites land them on that location. For org-scoped
  // (admin) invites we land on the inviter's current location — the location
  // switcher lets them hop to any other after sign-in.
  const targetSlug = (scope === "location" && locationId
    ? (await admin.from("locations").select("slug").eq("id", locationId).maybeSingle()).data?.slug
    : null) ?? ctx.location.slug;
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: tenantAuthCallbackUrl(targetSlug) },
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
  const normalisedEmail = email.trim().toLowerCase();

  // Resolve the target ONLY among members of the caller's org. A project-wide
  // listUsers() scan would let an owner mint a reset link for a user in another
  // tenant, and breaks past the 1000-user page cap. (#security Phase 1)
  const orgId = ctx.organization.id;
  const [orgUsersRes, locationsRes] = await Promise.all([
    admin.from("org_users").select("user_id").eq("organization_id", orgId),
    admin.from("locations").select("id").eq("organization_id", orgId),
  ]);
  const locationIds = ((locationsRes.data ?? []) as { id: string }[]).map((l) => l.id);
  const locUsersRes = locationIds.length
    ? await admin.from("location_users").select("user_id").in("location_id", locationIds)
    : { data: [] as { user_id: string }[] };

  const memberIds = [
    ...new Set([
      ...((orgUsersRes.data ?? []) as { user_id: string }[]).map((u) => u.user_id),
      ...((locUsersRes.data ?? []) as { user_id: string }[]).map((u) => u.user_id),
    ]),
  ];

  let targetUser: { id: string; emailConfirmed: boolean } | null = null;
  for (const id of memberIds) {
    const { data: lookup } = await admin.auth.admin.getUserById(id);
    if (lookup?.user?.email?.toLowerCase() === normalisedEmail) {
      targetUser = { id, emailConfirmed: Boolean(lookup.user.email_confirmed_at) };
      break;
    }
  }
  if (!targetUser) return { error: "User not found." };

  if (!targetUser.emailConfirmed) {
    await admin.auth.admin.updateUserById(targetUser.id, { email_confirm: true });
  }

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: tenantAuthCallbackUrl(ctx.location.slug) },
  });
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "staff.password_reset",
    entityType: "auth_user",
    entityId: targetUser.id,
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
  if (password.length < MIN_PASSWORD_LENGTH)
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };

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
