"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeRegistration, validateRegistration } from "@/lib/registration";
import { logAudit } from "@/lib/audit";
import { AGREEMENT_VERSION } from "@/lib/courtesy-agreement";
import {
  loanPhotoPath,
  loanSignaturePath,
  createPhotoUploadUrl,
  photoExists,
  isAllowedPhotoMime,
  COURTESY_PHOTO_MAX_BYTES,
  COURTESY_PHOTO_MAX_COUNT,
} from "@/lib/courtesy-photos";

// Courtesy car fleet + loan lifecycle. Reads are RLS-gated member selects;
// every write lands here behind the bookings permission.

type ActionResult = { error: string } | { success: true };

export async function addCourtesyCar(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };

  const regInput = String(formData.get("registration") ?? "").trim();
  const make = String(formData.get("make") ?? "").trim() || null;
  const model = String(formData.get("model") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const regError = validateRegistration(regInput);
  if (regError) return { error: regError };
  const registration = normalizeRegistration(regInput);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("courtesy_cars")
    .insert({ location_id: ctx.location.id, registration, make, model, notes })
    .select("id")
    .single();
  if (error) {
    return {
      error: error.message.includes("duplicate")
        ? "A courtesy car with that registration already exists."
        : error.message,
    };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    action: "courtesy_car.create",
    entityType: "courtesy_car",
    entityId: (data as { id: string }).id,
    metadata: { registration },
  });

  revalidatePath("/staff/courtesy-cars");
  return { success: true };
}

export async function setCourtesyCarActive(carId: string, active: boolean): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("courtesy_cars")
    .update({ active })
    .eq("id", carId)
    .eq("location_id", ctx.location.id);
  if (error) return { error: error.message };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "courtesy_car.update",
    entityType: "courtesy_car",
    entityId: carId,
    metadata: { active },
  });

  revalidatePath("/staff/courtesy-cars");
  return { success: true };
}

export type CheckOutResult = { error: string } | { success: true; loanId: string };

export async function checkOutCourtesyCar(formData: FormData): Promise<CheckOutResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };

  const carId = String(formData.get("carId") ?? "").trim();
  const customerId = String(formData.get("customerId") ?? "").trim();
  const jobId = String(formData.get("jobId") ?? "").trim() || null;
  const dueBackAt = String(formData.get("dueBackAt") ?? "").trim();
  const fuelOut = Number(formData.get("fuelOut"));
  const odometerOut = String(formData.get("odometerOut") ?? "").trim();
  const conditionOut = String(formData.get("conditionOut") ?? "").trim() || null;
  const licenceNumber = String(formData.get("licenceNumber") ?? "").trim() || null;
  const licenceShareCode = String(formData.get("licenceShareCode") ?? "").trim() || null;
  const agreementName = String(formData.get("agreementName") ?? "").trim();

  if (!carId || !customerId) return { error: "Pick a car and a customer." };
  if (!agreementName) return { error: "The customer must sign by typing their full name." };
  if (!Number.isInteger(fuelOut) || fuelOut < 0 || fuelOut > 8) {
    return { error: "Fuel level must be recorded (0–8 eighths)." };
  }

  const admin = createAdminClient();

  const [{ data: car }, { data: customer }] = await Promise.all([
    admin
      .from("courtesy_cars")
      .select("id, registration, active")
      .eq("id", carId)
      .eq("location_id", ctx.location.id)
      .maybeSingle(),
    admin
      .from("customers")
      .select("id, full_name")
      .eq("id", customerId)
      .eq("organization_id", ctx.organization.id)
      .maybeSingle(),
  ]);
  if (!car || !(car as { active: boolean }).active) return { error: "Car not found or inactive." };
  if (!customer) return { error: "Customer not found." };

  // Optional job linkage — must be this location's job for this customer.
  if (jobId) {
    const { data: job } = await admin
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .eq("location_id", ctx.location.id)
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!job) return { error: "That job doesn't belong to this customer." };
  }

  const { data: loan, error } = await admin.from("courtesy_car_loans").insert({
    location_id: ctx.location.id,
    car_id: carId,
    customer_id: customerId,
    job_id: jobId,
    due_back_at: dueBackAt ? new Date(dueBackAt).toISOString() : null,
    fuel_out: fuelOut,
    odometer_out: odometerOut ? Number(odometerOut) : null,
    condition_out: conditionOut,
    licence_number: licenceNumber,
    licence_share_code: licenceShareCode,
    agreement_name: agreementName,
    agreement_version: AGREEMENT_VERSION,
    agreement_signed_at: new Date().toISOString(),
    created_by: ctx.user.id,
  })
    .select("id")
    .single();
  if (error || !loan) {
    // The partial unique index fires when the car already has an open loan.
    return {
      error: error?.message.includes("courtesy_car_loans_open_uniq")
        ? "That car is already out on loan."
        : (error?.message ?? "Failed to create loan."),
    };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    action: "courtesy_car.checkout",
    entityType: "courtesy_car",
    entityId: carId,
    metadata: {
      registration: (car as { registration: string }).registration,
      customer_id: customerId,
      job_id: jobId,
      fuel_out: fuelOut,
      has_share_code: !!licenceShareCode,
    },
  });

  revalidatePath("/staff/courtesy-cars");
  return { success: true, loanId: (loan as { id: string }).id };
}

// ── Condition photos ─────────────────────────────────────────────────────────

export type PreparePhotoUploadsResult =
  | { error: string }
  | { success: true; uploads: { path: string; url: string }[] };

// Mint signed PUT URLs for direct client → storage upload (server-action
// bodies are too small for photos). Client uploads then calls
// attachLoanPhotos with the same paths.
export async function prepareLoanPhotoUploads(
  loanId: string,
  direction: "out" | "in",
  files: { mime: string; size: number; ext: string }[],
): Promise<PreparePhotoUploadsResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  if (files.length === 0 || files.length > COURTESY_PHOTO_MAX_COUNT) {
    return { error: `Between 1 and ${COURTESY_PHOTO_MAX_COUNT} photos.` };
  }
  for (const f of files) {
    if (!isAllowedPhotoMime(f.mime)) return { error: "Photos must be JPEG, PNG, or WebP." };
    if (f.size > COURTESY_PHOTO_MAX_BYTES) return { error: "Each photo must be under 10 MB." };
  }

  const admin = createAdminClient();
  const { data: loan } = await admin
    .from("courtesy_car_loans")
    .select("id")
    .eq("id", loanId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!loan) return { error: "Loan not found." };

  const uploads: { path: string; url: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    const path = loanPhotoPath(ctx.location.id, loanId, direction, i, files[i].ext);
    const minted = await createPhotoUploadUrl(path);
    if ("error" in minted) return { error: minted.error };
    uploads.push({ path, url: minted.url });
  }
  return { success: true, uploads };
}

export async function attachLoanPhotos(
  loanId: string,
  direction: "out" | "in",
  paths: string[],
): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  if (paths.length === 0 || paths.length > COURTESY_PHOTO_MAX_COUNT) {
    return { error: "Invalid photo list." };
  }
  // Paths must be inside this location's folder and actually uploaded.
  for (const path of paths) {
    if (!path.startsWith(`${ctx.location.id}/${loanId}/`)) return { error: "Invalid photo path." };
    if (!(await photoExists(path))) return { error: "A photo failed to upload — try again." };
  }

  const admin = createAdminClient();
  const column = direction === "out" ? "photos_out" : "photos_in";
  const { data: loan } = await admin
    .from("courtesy_car_loans")
    .select(`id, ${column}`)
    .eq("id", loanId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!loan) return { error: "Loan not found." };

  const existing = ((loan as Record<string, unknown>)[column] as string[]) ?? [];
  const merged = [...new Set([...existing, ...paths])].slice(0, COURTESY_PHOTO_MAX_COUNT);
  const { error } = await admin
    .from("courtesy_car_loans")
    .update({ [column]: merged })
    .eq("id", loanId);
  if (error) return { error: error.message };

  revalidatePath("/staff/courtesy-cars");
  return { success: true };
}

// ── Drawn signature ──────────────────────────────────────────────────────────

export type PrepareSignatureUploadResult =
  | { error: string }
  | { success: true; path: string; url: string };

// Mint a single signed PUT URL for the check-out signature PNG. Mirrors the
// photo flow: the client draws on a canvas, PUTs the blob, then calls
// attachLoanSignature with the same path.
export async function prepareLoanSignatureUpload(loanId: string): Promise<PrepareSignatureUploadResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };

  const admin = createAdminClient();
  const { data: loan } = await admin
    .from("courtesy_car_loans")
    .select("id")
    .eq("id", loanId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!loan) return { error: "Loan not found." };

  const path = loanSignaturePath(ctx.location.id, loanId);
  const minted = await createPhotoUploadUrl(path);
  if ("error" in minted) return { error: minted.error };
  return { success: true, path, url: minted.url };
}

export async function attachLoanSignature(loanId: string, path: string): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };
  if (!path.startsWith(`${ctx.location.id}/${loanId}/`)) return { error: "Invalid signature path." };
  if (!(await photoExists(path))) return { error: "Signature failed to upload — try again." };

  const admin = createAdminClient();
  const { data: loan } = await admin
    .from("courtesy_car_loans")
    .select("id")
    .eq("id", loanId)
    .eq("location_id", ctx.location.id)
    .maybeSingle();
  if (!loan) return { error: "Loan not found." };

  const { error } = await admin
    .from("courtesy_car_loans")
    .update({ signature_url: path })
    .eq("id", loanId);
  if (error) return { error: error.message };

  revalidatePath("/staff/courtesy-cars");
  return { success: true };
}

export async function returnCourtesyCar(formData: FormData): Promise<ActionResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "bookings")) return { error: "Permission denied." };

  const loanId = String(formData.get("loanId") ?? "").trim();
  const fuelIn = Number(formData.get("fuelIn"));
  const odometerIn = String(formData.get("odometerIn") ?? "").trim();
  const conditionIn = String(formData.get("conditionIn") ?? "").trim() || null;

  if (!loanId) return { error: "Loan not found." };
  if (!Number.isInteger(fuelIn) || fuelIn < 0 || fuelIn > 8) {
    return { error: "Fuel level must be recorded (0–8 eighths)." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("courtesy_car_loans")
    .update({
      returned_at: new Date().toISOString(),
      fuel_in: fuelIn,
      odometer_in: odometerIn ? Number(odometerIn) : null,
      condition_in: conditionIn,
    })
    .eq("id", loanId)
    .eq("location_id", ctx.location.id)
    .is("returned_at", null)
    .select("car_id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Loan not found or already returned." };

  await logAudit({
    organizationId: ctx.organization.id,
    action: "courtesy_car.return",
    entityType: "courtesy_car_loan",
    entityId: loanId,
    metadata: { car_id: (data as { car_id: string }).car_id, fuel_in: fuelIn },
  });

  revalidatePath("/staff/courtesy-cars");
  return { success: true };
}
