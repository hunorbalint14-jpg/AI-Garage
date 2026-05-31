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

type ImpersonationContext = {
  actor: { organizationId: string; userId: string; email: string | null };
  target: { type: "staff_user" | "customer"; id: string; email: string | null };
};

// The stash cookie holds the original auth cookies plus the actor/target
// identity captured at impersonation start. The `context` field is optional
// so that old-format stashes (bare cookie arrays, written before this change)
// can still be parsed and used to exit impersonation gracefully.
type Stash = {
  cookies: StashedCookie[];
  context?: ImpersonationContext;
};

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

async function setStash(stashedCookies: StashedCookie[], context: ImpersonationContext) {
  const store = await cookies();
  const payload: Stash = { cookies: stashedCookies, context };
  store.set(STASH_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
}

async function readStash(): Promise<Stash | null> {
  const store = await cookies();
  const raw = store.get(STASH_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Legacy format (pre-attribution fix): a bare array of StashedCookies
    // with no context object. Wrap it so callers always see a Stash shape.
    if (Array.isArray(parsed)) return { cookies: parsed as StashedCookie[] };
    return parsed as Stash;
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

  await setStash(stash, {
    actor: { organizationId: ctx.organization.id, userId: ctx.user.id, email: ctx.user.email ?? null },
    target: { type: "staff_user", id: user.id, email },
  });
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

  await setStash(stash, {
    actor: { organizationId: ctx.organization.id, userId: ctx.user.id, email: ctx.user.email ?? null },
    target: { type: "customer", id: customer.id, email: customer.email },
  });
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
  for (const c of stash.cookies) {
    store.set(c.name, c.value, { path: "/" });
  }
  await clearStash();

  // Actor + target identity were captured into the stash cookie at
  // impersonation start, so we can attribute the stop event even though the
  // impersonated session's auth cookies have just been cleared and the
  // restored RSC context hasn't re-evaluated yet. Legacy stashes (written
  // before this fix) carry no context — fall back to an unattributed entry
  // so sessions started before deploy can still be exited without error.
  if (stash.context) {
    await logAudit({
      organizationId: stash.context.actor.organizationId,
      actorUserId: stash.context.actor.userId,
      actorEmail: stash.context.actor.email,
      action: "impersonation.stop",
      entityType: stash.context.target.type,
      entityId: stash.context.target.id,
      metadata: { target_email: stash.context.target.email },
    });
  } else {
    await logAudit({ action: "impersonation.stop" });
  }

  revalidatePath("/", "layout");
  redirect("/staff/dev");
}

export async function isImpersonating(): Promise<boolean> {
  const stash = await readStash();
  return !!stash && stash.cookies.length > 0;
}
