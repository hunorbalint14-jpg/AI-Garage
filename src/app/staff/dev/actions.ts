"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

export type ImpersonateResult = { error: string } | { success: true; redirect: string };

const STASH_COOKIE = "ai_impersonator_stash";

async function guardOwner() {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    throw new Error("Owner or admin only.");
  }
  return ctx;
}

type StashedCookie = { name: string; value: string };

async function snapshotAuthCookies(): Promise<StashedCookie[]> {
  const store = await cookies();
  return store
    .getAll()
    .filter((c) => c.name.startsWith("sb-"))
    .map((c) => ({ name: c.name, value: c.value }));
}

async function clearAuthCookies() {
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) {
      store.delete(c.name);
    }
  }
}

async function setStash(stashed: StashedCookie[]) {
  const store = await cookies();
  store.set(STASH_COOKIE, JSON.stringify(stashed), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
}

async function readStash(): Promise<StashedCookie[] | null> {
  const store = await cookies();
  const raw = store.get(STASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StashedCookie[];
  } catch {
    return null;
  }
}

async function clearStash() {
  const store = await cookies();
  store.delete(STASH_COOKIE);
}

async function mintSessionForEmail(email: string): Promise<{ error: string } | { success: true }> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) return { error: error.message };
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) return { error: "No token returned by generateLink." };

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) return { error: verifyErr.message };
  return { success: true };
}

export async function impersonateStaff(email: string): Promise<ImpersonateResult> {
  let ctx;
  try {
    ctx = await guardOwner();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const admin = createAdminClient();
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) return { error: "No auth account found for this staff member." };

  if (!user.email_confirmed_at) {
    await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
  }

  const stash = await snapshotAuthCookies();
  await clearAuthCookies();

  const result = await mintSessionForEmail(email);
  if ("error" in result) {
    // Restore on failure
    const store = await cookies();
    for (const c of stash) store.set(c.name, c.value, { path: "/" });
    return { error: result.error };
  }

  await setStash(stash);
  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "impersonation.start",
    entityType: "staff_user",
    entityId: user.id,
    metadata: { target_email: email },
  });
  revalidatePath("/", "layout");
  return { success: true, redirect: "/staff" };
}

export async function impersonateCustomer(customerId: string): Promise<ImpersonateResult> {
  let ctx;
  try {
    ctx = await guardOwner();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const admin = createAdminClient();

  const { data: customer } = await admin
    .from("customers")
    .select("id, email, full_name, user_id, location_id")
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) return { error: "Customer not found." };
  if (!customer.email) return { error: "Customer has no email address." };

  const { data: loc } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", customer.location_id)
    .maybeSingle();
  if (!loc || loc.organization_id !== ctx.organization.id) {
    return { error: "Customer not in this organisation." };
  }

  if (!customer.user_id) {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: customer.email,
      email_confirm: true,
      user_metadata: { full_name: customer.full_name },
    });

    if (createErr) {
      const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = users.find((u) => u.email?.toLowerCase() === customer.email!.toLowerCase());
      if (!existing) return { error: `Could not create auth account: ${createErr.message}` };
      await admin.from("customers").update({ user_id: existing.id }).eq("id", customerId);
    } else {
      await admin.from("customers").update({ user_id: newUser.user.id }).eq("id", customerId);
    }
  }

  const stash = await snapshotAuthCookies();
  await clearAuthCookies();

  const result = await mintSessionForEmail(customer.email);
  if ("error" in result) {
    const store = await cookies();
    for (const c of stash) store.set(c.name, c.value, { path: "/" });
    return { error: result.error };
  }

  await setStash(stash);
  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "impersonation.start",
    entityType: "customer",
    entityId: customer.id,
    metadata: { target_email: customer.email },
  });
  revalidatePath("/", "layout");
  return { success: true, redirect: "/dashboard" };
}

export async function exitImpersonation(): Promise<void> {
  const stash = await readStash();
  if (!stash) {
    redirect("/staff/dev");
  }

  await clearAuthCookies();
  const store = await cookies();
  for (const c of stash) {
    store.set(c.name, c.value, { path: "/" });
  }
  await clearStash();

  // We can't read ctx here — the impersonating session was just cleared
  // and the original cookies are now in place but RSC won't re-evaluate
  // until the redirect. Log as actor-unknown; the start event already
  // carries the actor.
  await logAudit({
    action: "impersonation.stop",
  });

  revalidatePath("/", "layout");
  redirect("/staff/dev");
}

export async function isImpersonating(): Promise<boolean> {
  const stash = await readStash();
  return !!stash && stash.length > 0;
}
