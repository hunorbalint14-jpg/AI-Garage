"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedDemoData, wipeDemoData } from "@/lib/demo-sandbox";
import { logAudit } from "@/lib/audit";

// Demo sandbox actions (#506 PR 3). Owner/admin only — exploring with sample
// data is an org-setup decision, not a per-user toy.

export type SandboxResult = { error: string } | { success: true };

export async function seedDemoSandbox(): Promise<SandboxResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };

  const admin = createAdminClient();
  const res = await seedDemoData(admin, ctx.organization.id, ctx.location.id);
  if (res.error) return { error: res.error };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "demo.seeded",
    entityType: "organization",
    entityId: ctx.organization.id,
    metadata: { customers: res.customers, location_id: ctx.location.id },
  });

  revalidatePath("/staff", "layout");
  return { success: true };
}

export async function wipeDemoSandbox(): Promise<SandboxResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner" && ctx.orgRole !== "admin") return { error: "Permission denied." };

  const admin = createAdminClient();
  const res = await wipeDemoData(admin, ctx.organization.id);
  if (res.error) return { error: res.error };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "demo.wiped",
    entityType: "organization",
    entityId: ctx.organization.id,
  });

  revalidatePath("/staff", "layout");
  return { success: true };
}
