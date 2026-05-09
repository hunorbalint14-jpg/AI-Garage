"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type TestLoginResult = { error: string } | { success: true; link: string };

async function guardOwner() {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") {
    throw new Error("Owner or admin only.");
  }
  return ctx;
}

export async function generateStaffTestLink(email: string): Promise<TestLoginResult> {
  try {
    await guardOwner();
  } catch (e) {
    return { error: (e as Error).message };
  }

  const admin = createAdminClient();

  // Ensure email is confirmed before generating magic link
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) return { error: "No auth account found for this staff member." };

  if (!user.email_confirmed_at) {
    await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `http://${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"}`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${siteUrl}/auth/callback?next=/staff` },
  });
  if (error) return { error: error.message };
  return { success: true, link: data.properties.action_link };
}

export async function generateCustomerTestLink(customerId: string): Promise<TestLoginResult> {
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

  // Verify customer belongs to this org
  const { data: loc } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", customer.location_id)
    .maybeSingle();
  if (!loc || loc.organization_id !== ctx.organization.id) {
    return { error: "Customer not in this organisation." };
  }

  // If customer has no auth account, create one
  if (!customer.user_id) {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: customer.email,
      email_confirm: true,
      user_metadata: { full_name: customer.full_name },
    });

    if (createErr) {
      // User may already exist in auth but not linked
      const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = users.find((u) => u.email?.toLowerCase() === customer.email!.toLowerCase());
      if (!existing) return { error: `Could not create auth account: ${createErr.message}` };

      await admin.from("customers").update({ user_id: existing.id }).eq("id", customerId);
    } else {
      await admin.from("customers").update({ user_id: newUser.user.id }).eq("id", customerId);
    }

    revalidatePath(`/staff/customers/${customerId}`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? `http://${process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000"}`;
  const { data, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: customer.email,
    options: { redirectTo: `${siteUrl}/auth/callback?next=/dashboard` },
  });
  if (linkErr) return { error: linkErr.message };
  return { success: true, link: data.properties.action_link };
}
