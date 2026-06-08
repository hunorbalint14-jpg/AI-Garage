import { createAdminClient } from "@/lib/supabase/admin";

// Platform-operator access. Two sources, OR'd together:
//   1. PLATFORM_ADMIN_EMAILS env (comma-separated) — the bootstrap allowlist,
//      so the first operator can always get in to invite others.
//   2. the platform_admins table — invited operators (authoritative going
//      forward). Membership here also grants owner-level access to every
//      tenant's staff portal via the is_platform_admin() RLS helper.

export function platformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

// Whether the given email is in the env bootstrap allowlist. Case-insensitive;
// null/empty emails and an unconfigured allowlist both return false.
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminEmails().has(email.trim().toLowerCase());
}

// Authoritative check for a signed-in user: env allowlist OR a platform_admins
// row. Use this for gating (layout, login, cross-tenant staff context).
export async function isPlatformAdminUser(
  user: { id: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  if (isPlatformAdmin(user.email)) return true;
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return !!data;
}
