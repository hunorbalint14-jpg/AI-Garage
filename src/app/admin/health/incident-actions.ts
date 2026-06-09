"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";
import { PLATFORM_COMPONENTS } from "@/lib/platform/components";

const SEVERITIES = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];
const STATUSES = ["Investigating", "Identified", "Monitoring", "Resolved"];

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type ActionResult = { error: string } | { success: true };

function newRef(): string {
  return "INC-" + Date.now().toString().slice(-5);
}

// Declare a new incident with its first update.
export async function declareIncident(formData: FormData): Promise<ActionResult> {
  const actor = await requirePlatformAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const severity = String(formData.get("severity") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const published = formData.get("published") === "on";
  const components = (formData.getAll("components") as string[]).filter((c) =>
    (PLATFORM_COMPONENTS as readonly string[]).includes(c),
  );
  if (!title) return { error: "Title is required." };
  if (!SEVERITIES.includes(severity)) return { error: "Pick a severity." };
  if (!body) return { error: "An initial update is required." };

  const admin = createAdminClient();
  const { data: inc, error } = await admin
    .from("incidents")
    .insert({
      ref: newRef(),
      title,
      severity,
      status: "Investigating",
      components,
      published,
      lead_user_id: actor.id,
    })
    .select("id, ref")
    .single();
  if (error || !inc) return { error: error?.message ?? "Could not create incident." };

  await admin.from("incident_updates").insert({
    incident_id: inc.id,
    status: "Investigating",
    body,
    actor_email: actor.email ?? null,
    public: published,
  });

  await logAudit({
    action: "incident.declare",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: inc.id,
    metadata: { ref: inc.ref, severity, components, published },
  });

  revalidatePath("/admin/health");
  return { success: true };
}

// Append an update and move the incident's status. "Resolved" closes it.
export async function addIncidentUpdate(formData: FormData): Promise<ActionResult> {
  const actor = await requirePlatformAdmin();

  const incidentId = String(formData.get("incidentId") ?? "");
  const status = String(formData.get("status") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const isPublic = formData.get("public") === "on";
  if (!incidentId) return { error: "Missing incident." };
  if (!STATUSES.includes(status)) return { error: "Invalid status." };
  if (!body) return { error: "Update text is required." };

  const admin = createAdminClient();
  await admin.from("incident_updates").insert({
    incident_id: incidentId,
    status,
    body,
    actor_email: actor.email ?? null,
    public: isPublic,
  });

  const patch: Record<string, unknown> = { status };
  if (status === "Resolved") patch.resolved_at = new Date().toISOString();
  await admin.from("incidents").update(patch).eq("id", incidentId);

  await logAudit({
    action: status === "Resolved" ? "incident.resolve" : "incident.update",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: incidentId,
    metadata: { status, public: isPublic },
  });

  revalidatePath("/admin/health");
  return { success: true };
}

export async function setIncidentPublished(incidentId: string, published: boolean): Promise<ActionResult> {
  const actor = await requirePlatformAdmin();
  if (!incidentId) return { error: "Missing incident." };
  const admin = createAdminClient();
  await admin.from("incidents").update({ published }).eq("id", incidentId);
  await logAudit({
    action: "incident.publish",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: incidentId,
    metadata: { published },
  });
  revalidatePath("/admin/health");
  return { success: true };
}

export async function ackIncident(incidentId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin();
  if (!incidentId) return { error: "Missing incident." };
  const admin = createAdminClient();
  await admin.from("incidents").update({ acked_at: new Date().toISOString() }).eq("id", incidentId);
  await logAudit({
    action: "incident.ack",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: incidentId,
  });
  revalidatePath("/admin/health");
  return { success: true };
}
