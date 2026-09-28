"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { logAudit } from "@/lib/audit";
import { PLATFORM_COMPONENTS } from "@/lib/platform/components";
import { incidentRef } from "@/lib/platform/alerts";

const SEVERITIES = ["SEV-1", "SEV-2", "SEV-3", "SEV-4"];
const STATUSES = ["Investigating", "Identified", "Monitoring", "Resolved"];

export type ActionResult = { error: string } | { success: true };

// The incidents panel lives on /admin/incidents (it used to sit on
// /admin/health); /status reads the same rows.
function revalidateIncidentViews() {
  revalidatePath("/admin/incidents");
  revalidatePath("/admin/health");
  revalidatePath("/status");
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
      // Shared with auto-declare: a clock-only ref repeats every 100 s and
      // `ref` is UNIQUE, so a collision silently failed the insert.
      ref: incidentRef(),
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

  const { error: updateError } = await admin.from("incident_updates").insert({
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

  revalidateIncidentViews();
  if (updateError) {
    return { error: `Incident ${inc.ref} was declared, but its first update didn't save: ${updateError.message}` };
  }
  return { success: true };
}

// Append an update and move the incident's status. "Resolved" closes it.
//
// A PUBLIC update publishes its incident. /status only lists published
// incidents, so a public update on an unpublished one used to be marked
// "·public" in the admin timeline and still appear nowhere — the incident had
// to be published separately, which is easy to miss mid-incident (and
// auto-declared incidents always start unpublished).
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
  const { data: incident, error: readError } = await admin
    .from("incidents")
    .select("id, published")
    .eq("id", incidentId)
    .maybeSingle();
  if (readError) return { error: readError.message };
  if (!incident) return { error: "Incident not found." };
  const publishing = isPublic && !(incident as { published: boolean }).published;

  const { error: insertError } = await admin.from("incident_updates").insert({
    incident_id: incidentId,
    status,
    body,
    actor_email: actor.email ?? null,
    public: isPublic,
  });
  if (insertError) return { error: `The update didn't save: ${insertError.message}` };

  const patch: Record<string, unknown> = { status };
  if (status === "Resolved") patch.resolved_at = new Date().toISOString();
  if (publishing) patch.published = true;
  const { error: patchError } = await admin.from("incidents").update(patch).eq("id", incidentId);

  await logAudit({
    action: status === "Resolved" ? "incident.resolve" : "incident.update",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: incidentId,
    metadata: { status, public: isPublic, ...(publishing ? { published: true } : {}) },
  });

  revalidateIncidentViews();
  if (patchError) {
    return { error: `The update was saved, but the incident status didn't change: ${patchError.message}` };
  }
  return { success: true };
}

export async function setIncidentPublished(incidentId: string, published: boolean): Promise<ActionResult> {
  const actor = await requirePlatformAdmin();
  if (!incidentId) return { error: "Missing incident." };
  const admin = createAdminClient();
  const { error } = await admin.from("incidents").update({ published }).eq("id", incidentId);
  if (error) return { error: error.message };
  await logAudit({
    action: "incident.publish",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: incidentId,
    metadata: { published },
  });
  revalidateIncidentViews();
  return { success: true };
}

export async function ackIncident(incidentId: string): Promise<ActionResult> {
  const actor = await requirePlatformAdmin();
  if (!incidentId) return { error: "Missing incident." };
  const admin = createAdminClient();
  const { error } = await admin.from("incidents").update({ acked_at: new Date().toISOString() }).eq("id", incidentId);
  if (error) return { error: error.message };
  await logAudit({
    action: "incident.ack",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    entityType: "incident",
    entityId: incidentId,
  });
  revalidateIncidentViews();
  return { success: true };
}
