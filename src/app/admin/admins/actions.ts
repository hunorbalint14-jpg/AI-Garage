"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { sendEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";
import { emailSchema, parseOrError } from "@/lib/validation";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

const ROOT = process.env.ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localtest.me:3000";
const ROOT_HOST = ROOT.split(":")[0];
const PORT = ROOT.includes(":") ? `:${ROOT.split(":")[1]}` : "";
const PROTO =
  ROOT_HOST === "localhost" || ROOT_HOST.endsWith("localtest.me") || ROOT_HOST.endsWith(".local") ? "http" : "https";

// Mint a one-time cross-subdomain sign-in link for `email` that lands on `host`
// at `next` (via the /auth/handoff OTP-verify route — which, unlike
// /auth/callback, does not rewrite the destination to /staff).
async function mintHandoff(email: string, host: string, next: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return null;
  return `${PROTO}://${host}${PORT}/auth/handoff?token_hash=${encodeURIComponent(tokenHash)}&next=${encodeURIComponent(next)}`;
}

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type InviteResult = { error: string } | { success: true; inviteLink: string };

// Invite a new platform admin. Creates (or reuses) the Supabase user, adds the
// platform_admins row immediately, and emails a branded one-time link to the
// admin dashboard where they can set a password.
export async function invitePlatformAdmin(formData: FormData): Promise<InviteResult> {
  const inviter = await requirePlatformAdmin();

  const emailParsed = parseOrError(emailSchema, formData.get("email"));
  if ("error" in emailParsed) return emailParsed;
  const email = emailParsed.data;

  const admin = createAdminClient();

  // Find an existing auth user, else create one (email pre-confirmed so the
  // magic link works) — same approach as staff invites.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let userId: string;
  if (existing) {
    userId = existing.id;
    if (!existing.email_confirmed_at) {
      await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    }
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created.user) return { error: createErr?.message ?? "Could not create user." };
    userId = created.user.id;
  }

  const { error: insErr } = await admin
    .from("platform_admins")
    .upsert({ user_id: userId, invited_by: inviter.id }, { onConflict: "user_id", ignoreDuplicates: true });
  if (insErr) return { error: insErr.message };

  const link = await mintHandoff(email, `admin.${ROOT_HOST}`, "/admin");
  if (!link) return { error: "Added, but failed to generate the invite link. Ask them to sign in at the admin login." };

  await sendEmail({
    to: email,
    subject: "You've been added as an AI Garage platform admin",
    text: `You've been granted platform-admin access to AI Garage — oversight across all garages, and owner-level access to every garage's portal.\n\nClick the link below to sign in and set your password:\n\n${link}\n\nThis link is single-use and expires shortly. If you didn't expect this, contact whoever invited you.\n\nAI Garage`,
  });

  await logAudit({
    action: "platform_admin.invite",
    actorUserId: inviter.id,
    actorEmail: inviter.email ?? null,
    entityType: "auth_user",
    entityId: userId,
    metadata: { email },
  });

  revalidatePath("/admin/admins");
  return { success: true, inviteLink: link };
}

export async function revokePlatformAdmin(userId: string): Promise<void> {
  const actor = await requirePlatformAdmin();
  const admin = createAdminClient();
  await admin.from("platform_admins").delete().eq("user_id", userId);
  await logAudit({
    action: "platform_admin.revoke",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "auth_user",
    entityId: userId,
  });
  revalidatePath("/admin/admins");
}

export type PasswordResult = { error: string } | { success: true };

// Let the signed-in admin set their own password (e.g. right after accepting an
// invite via the magic link). Uses the cookie session, so no current password
// is required for this freshly-authenticated session.
export async function setOwnPassword(formData: FormData): Promise<PasswordResult> {
  await requirePlatformAdmin();
  const password = String(formData.get("password") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  return { success: true };
}
