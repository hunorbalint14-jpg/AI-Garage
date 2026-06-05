"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext, type StaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { ensurePlanStripePrices, type ServicePlanRow } from "@/lib/service-plans";

export type PlanResult = { error: string } | { success: true };

function requireOwner(ctx: StaffContext) {
  if (!hasPermission(ctx, "services")) throw new Error("Permission denied.");
}

function parsePence(v: FormDataEntryValue | null): number | null {
  const s = (v as string | null)?.trim();
  if (!s) return null;
  const f = parseFloat(s);
  if (!Number.isFinite(f) || f < 0) return null;
  return Math.round(f * 100);
}

// Read the member-discount config from the form. Normalises to 'none' when the
// value is zero/blank; clamps a percentage to 100.
function parseDiscount(formData: FormData): { discount_type: "none" | "percent" | "fixed"; discount_value: number } {
  const type = (formData.get("discountType") as string | null) ?? "none";
  const raw = parseFloat((formData.get("discountValue") as string | null)?.trim() || "0");
  const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (value <= 0) return { discount_type: "none", discount_value: 0 };
  if (type === "percent") return { discount_type: "percent", discount_value: Math.min(100, value) };
  if (type === "fixed") return { discount_type: "fixed", discount_value: value };
  return { discount_type: "none", discount_value: 0 };
}

type Admin = ReturnType<typeof createAdminClient>;

// Replace a plan's included-services bundle from the form's JSON field. Only
// keeps services that belong to this location; dedupes by service; clamps qty.
async function syncPlanItems(admin: Admin, locationId: string, planId: string, formData: FormData) {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse((formData.get("includedServices") as string | null) ?? "[]");
  } catch {
    parsed = [];
  }
  const byId = new Map<string, number>();
  if (Array.isArray(parsed)) {
    for (const x of parsed) {
      const sid = (x as { service_id?: unknown }).service_id;
      const qty = Number((x as { quantity_per_period?: unknown }).quantity_per_period);
      if (typeof sid === "string" && Number.isFinite(qty) && qty > 0) {
        byId.set(sid, Math.max(1, Math.round(qty)));
      }
    }
  }

  const ids = [...byId.keys()];
  let allowed = new Set<string>();
  if (ids.length) {
    const { data } = await admin.from("services").select("id").eq("location_id", locationId).in("id", ids);
    allowed = new Set((data ?? []).map((s) => (s as { id: string }).id));
  }

  await admin.from("service_plan_items").delete().eq("service_plan_id", planId);
  const rows = ids
    .filter((id) => allowed.has(id))
    .map((id) => ({ service_plan_id: planId, service_id: id, quantity_per_period: byId.get(id)! }));
  if (rows.length) await admin.from("service_plan_items").insert(rows);
}

// Best-effort: create the plan's Stripe Product + Price(s) on the connected
// account if the garage has finished Stripe onboarding. Failure isn't fatal —
// prices are also ensured lazily at subscribe time.
async function tryEnsurePrices(admin: Admin, organizationId: string, plan: ServicePlanRow) {
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id, stripe_charges_enabled")
    .eq("id", organizationId)
    .maybeSingle();
  const o = org as { stripe_account_id: string | null; stripe_charges_enabled: boolean | null } | null;
  if (!o?.stripe_account_id || !o.stripe_charges_enabled) return;
  try {
    await ensurePlanStripePrices(admin, plan, o.stripe_account_id);
  } catch (err) {
    console.error("[plans] ensurePlanStripePrices failed (deferred to subscribe time)", err);
  }
}

// Create or edit a plan. Prices are set at creation and are immutable on edit —
// Stripe Prices can't be changed in place, so editing only touches name +
// description (create a new plan to reprice).
export async function upsertServicePlan(formData: FormData, planId?: string): Promise<PlanResult> {
  const ctx = await requireStaffContext();
  try {
    requireOwner(ctx);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const admin = createAdminClient();

  const name = (formData.get("name") as string | null)?.trim();
  const description = (formData.get("description") as string | null)?.trim() || null;
  if (!name) return { error: "Plan name is required." };

  const discount = parseDiscount(formData);

  if (planId) {
    const { error } = await admin
      .from("service_plans")
      .update({ name, description, ...discount })
      .eq("id", planId)
      .eq("location_id", ctx.location.id);
    if (error) return { error: error.message };

    await syncPlanItems(admin, ctx.location.id, planId, formData);

    await logAudit({
      organizationId: ctx.organization.id,
      actorUserId: ctx.user.id,
      actorEmail: ctx.user.email ?? null,
      action: "service_plan.upsert",
      entityType: "service_plan",
      entityId: planId,
      metadata: { mode: "update", name, ...discount },
    });
    revalidatePath("/staff/plans");
    return { success: true };
  }

  const monthly = parsePence(formData.get("priceMonthly"));
  const annual = parsePence(formData.get("priceAnnual"));
  if (monthly == null && annual == null) {
    return { error: "Set a monthly and/or annual price." };
  }

  const { data, error } = await admin
    .from("service_plans")
    .insert({
      location_id: ctx.location.id,
      name,
      description,
      price_monthly_pence: monthly,
      price_annual_pence: annual,
      discount_type: discount.discount_type,
      discount_value: discount.discount_value,
      created_by: ctx.user.id,
    })
    .select(
      "id, location_id, name, description, price_monthly_pence, price_annual_pence, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, active, discount_type, discount_value",
    )
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create the plan." };

  await syncPlanItems(admin, ctx.location.id, data.id, formData);
  await tryEnsurePrices(admin, ctx.organization.id, data as ServicePlanRow);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "service_plan.upsert",
    entityType: "service_plan",
    entityId: data.id,
    metadata: { mode: "create", name, price_monthly_pence: monthly, price_annual_pence: annual },
  });

  revalidatePath("/staff/plans");
  return { success: true };
}

export async function togglePlanActive(planId: string, active: boolean): Promise<PlanResult> {
  const ctx = await requireStaffContext();
  try {
    requireOwner(ctx);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("service_plans")
    .update({ active })
    .eq("id", planId)
    .eq("location_id", ctx.location.id)
    .select(
      "id, location_id, name, description, price_monthly_pence, price_annual_pence, stripe_product_id, stripe_price_monthly_id, stripe_price_annual_id, active, discount_type, discount_value",
    )
    .single();
  if (error || !data) return { error: error?.message ?? "Plan not found." };

  // Make sure an activated plan is subscribe-ready (Stripe prices exist).
  if (active) await tryEnsurePrices(admin, ctx.organization.id, data as ServicePlanRow);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "service_plan.upsert",
    entityType: "service_plan",
    entityId: planId,
    metadata: { mode: "toggle_active", active },
  });

  revalidatePath("/staff/plans");
  return { success: true };
}

export async function deleteServicePlan(planId: string): Promise<PlanResult> {
  const ctx = await requireStaffContext();
  try {
    requireOwner(ctx);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const admin = createAdminClient();

  // Block deletion while live subscriptions still bill against the plan —
  // deactivate instead so the membership keeps renewing until cancelled.
  const { count } = await admin
    .from("plan_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("service_plan_id", planId)
    .in("status", ["active", "trialing", "past_due"]);
  if (count && count > 0) {
    return { error: "This plan has active subscribers. Deactivate it instead." };
  }

  const { error } = await admin
    .from("service_plans")
    .delete()
    .eq("id", planId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "service_plan.delete",
    entityType: "service_plan",
    entityId: planId,
  });

  revalidatePath("/staff/plans");
  return { success: true };
}
