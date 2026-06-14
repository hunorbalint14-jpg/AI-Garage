"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import {
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber,
  type AvailableNumber,
  type NumberType,
} from "@/lib/receptionist/provisioning";
import { logAudit } from "@/lib/audit";

// Platform-operator provisioning of receptionist Twilio numbers. Buying a
// number spends real money on the platform Twilio account, so every mutation
// is gated to platform admins and the purchase + DB write are kept consistent
// (a failed write releases the number it just bought, rather than orphaning a
// paid line).

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type SearchResult = { error: string } | { numbers: AvailableNumber[] };
export type ProvisionResult = { error: string } | { success: true; phoneNumber: string };
export type ReleaseResult = { error: string } | { success: true };

export async function searchReceptionistNumbers(args: {
  country: string;
  type: NumberType;
  areaCode?: string;
  contains?: string;
}): Promise<SearchResult> {
  await requirePlatformAdmin();
  try {
    const numbers = await searchAvailableNumbers(args);
    if (numbers.length === 0) return { error: "No matching numbers available — try a broader search." };
    return { numbers };
  } catch (err) {
    console.error("[receptionist] number search failed", err);
    return { error: err instanceof Error ? err.message : "Number search failed." };
  }
}

export async function provisionReceptionistNumber(args: {
  locationId: string;
  phoneNumber: string;
}): Promise<ProvisionResult> {
  const actor = await requirePlatformAdmin();
  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("id, name, organization_id")
    .eq("id", args.locationId)
    .maybeSingle();
  if (!location) return { error: "Location not found." };

  const { data: existing } = await admin
    .from("receptionist_configs")
    .select("twilio_number")
    .eq("location_id", args.locationId)
    .maybeSingle();
  if (existing?.twilio_number) {
    return { error: "This location already has a number. Release it before provisioning another." };
  }

  let bought;
  try {
    bought = await purchaseNumber({ phoneNumber: args.phoneNumber, friendlyName: location.name });
  } catch (err) {
    console.error("[receptionist] number purchase failed", err);
    return { error: err instanceof Error ? err.message : "Could not buy that number — it may have just been taken." };
  }

  const { error: writeError } = await admin.from("receptionist_configs").upsert(
    {
      location_id: args.locationId,
      twilio_number: bought.phoneNumber,
      twilio_number_sid: bought.sid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "location_id" },
  );
  if (writeError) {
    // Don't leave a paid number stranded if we couldn't record it.
    console.error("[receptionist] config write failed after purchase — releasing", writeError.message);
    await releaseNumber(bought.sid).catch(() => {});
    return { error: "Bought the number but couldn't save it — released it again. Please retry." };
  }

  await logAudit({
    action: "receptionist.number_provisioned",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    organizationId: location.organization_id,
    entityType: "receptionist_config",
    entityId: args.locationId,
    metadata: { phone_number: bought.phoneNumber, sid: bought.sid, via: "platform_admin" },
  });

  revalidatePath(`/admin/orgs/${location.organization_id}`);
  return { success: true, phoneNumber: bought.phoneNumber };
}

export async function releaseReceptionistNumber(args: {
  locationId: string;
}): Promise<ReleaseResult> {
  const actor = await requirePlatformAdmin();
  const admin = createAdminClient();

  const { data: location } = await admin
    .from("locations")
    .select("organization_id")
    .eq("id", args.locationId)
    .maybeSingle();
  if (!location) return { error: "Location not found." };

  const { data: config } = await admin
    .from("receptionist_configs")
    .select("twilio_number, twilio_number_sid")
    .eq("location_id", args.locationId)
    .maybeSingle();
  if (!config?.twilio_number) return { error: "No number to release." };

  // Only numbers we bought (have a SID) can be released via the API; a hand-set
  // number is just unlinked here and must be released in Twilio if desired.
  if (config.twilio_number_sid) {
    try {
      await releaseNumber(config.twilio_number_sid);
    } catch (err) {
      console.error("[receptionist] number release failed", err);
      return { error: err instanceof Error ? err.message : "Could not release the number in Twilio." };
    }
  }

  const { error: writeError } = await admin
    .from("receptionist_configs")
    .update({ twilio_number: null, twilio_number_sid: null, enabled: false, updated_at: new Date().toISOString() })
    .eq("location_id", args.locationId);
  if (writeError) return { error: writeError.message };

  await logAudit({
    action: "receptionist.number_released",
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    organizationId: location.organization_id,
    entityType: "receptionist_config",
    entityId: args.locationId,
    metadata: { phone_number: config.twilio_number, sid: config.twilio_number_sid, via: "platform_admin" },
  });

  revalidatePath(`/admin/orgs/${location.organization_id}`);
  return { success: true };
}
