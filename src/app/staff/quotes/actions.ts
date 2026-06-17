"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { garageLabel, garageLocationBlock, garageLocationInline } from "@/lib/garage-identity";
import { logAudit } from "@/lib/audit";
import {
  generateQuoteToken,
  generateStandaloneQuoteSlug,
  hashQuoteToken,
  tenantQuoteUrl,
} from "@/lib/quote-links";
import {
  QUOTE_VIDEO_MAX_BYTES,
  isAllowedVideoMime,
  createUploadUrl,
  videoObjectExists,
  standaloneVideoPath,
  removeVideoObject,
} from "@/lib/quote-storage";

export type StandaloneQuoteItemInput = {
  description: string;
  type: "part" | "labour" | "other";
  quantity: number;
  unit_price: number;
  product_id?: string | null;
};

const VAT_RATE = 20;

function computeTotals(items: StandaloneQuoteItemInput[]) {
  const subtotal = items.reduce(
    (sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0),
    0,
  );
  const subtotalRounded = Math.round(subtotal * 100) / 100;
  const vat = Math.round(subtotalRounded * VAT_RATE) / 100;
  const total = Math.round((subtotalRounded + vat) * 100) / 100;
  return { subtotal: subtotalRounded, vat, total };
}

// ---------------------------------------------------------------------------
// Step 1 — mint a signed upload URL for the (optional) diagnosis video.
// Client PUTs file directly to Supabase Storage; server records the storage
// path on the quote row in createStandaloneQuote.
// ---------------------------------------------------------------------------
export type PrepareUploadResult =
  | { error: string }
  | { success: true; uploadUrl: string; path: string; quoteId: string };

export async function prepareStandaloneQuoteUpload(
  fileMime: string,
  fileSizeBytes: number,
  fileExt: string,
): Promise<PrepareUploadResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };

  if (!isAllowedVideoMime(fileMime)) {
    return { error: "Unsupported video format. Use MP4, MOV, or WebM." };
  }
  if (fileSizeBytes > QUOTE_VIDEO_MAX_BYTES) {
    return { error: "Video too large (max 80 MB)." };
  }

  // Pre-mint the quote id so the path is stable across mint + insert.
  const quoteId = crypto.randomUUID();
  const path = standaloneVideoPath(ctx.location.id, quoteId, fileExt);
  const upload = await createUploadUrl(path);
  if ("error" in upload) return { error: upload.error };
  return { success: true, uploadUrl: upload.url, path, quoteId };
}

// ---------------------------------------------------------------------------
// createStandaloneQuote — inserts a draft (or pending if sendImmediately).
// expiresInDays defaults from organizations.quote_validity_days (UK = 30).
// ---------------------------------------------------------------------------
export type CreateStandaloneQuoteResult =
  | { error: string }
  | { success: true; quoteId: string; customerUrl?: string; total: number };

export async function createStandaloneQuote(args: {
  quoteId?: string;
  customerId: string;
  vehicleId?: string | null;
  title?: string;
  description?: string;
  customerMessage?: string;
  items: StandaloneQuoteItemInput[];
  videoPath?: string | null;
  videoMime?: string | null;
  videoSizeBytes?: number | null;
  expiresInDays?: number;
  sendImmediately?: boolean;
}): Promise<CreateStandaloneQuoteResult> {
  const ctx = await requireStaffContext();
  // Send-immediately requires the send permission too; otherwise drafting is enough.
  const needed = args.sendImmediately ? "quotes_send" : "quotes_draft";
  if (!hasPermission(ctx, needed)) return { error: "Permission denied." };
  const admin = createAdminClient();

  if (!args.items.length) return { error: "Add at least one line item." };
  for (const it of args.items) {
    if (!it.description?.trim()) return { error: "Every item needs a description." };
    if (!["part", "labour", "other"].includes(it.type)) return { error: "Invalid item type." };
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) return { error: "Quantity must be greater than 0." };
    if (!Number.isFinite(it.unit_price) || it.unit_price < 0) return { error: "Unit price must be 0 or greater." };
  }

  // Verify customer + vehicle belong to this org (both are org-global now).
  const { data: customer } = await admin
    .from("customers")
    .select("id, organization_id")
    .eq("id", args.customerId)
    .maybeSingle();
  if (!customer || (customer as { organization_id: string }).organization_id !== ctx.organization.id) {
    return { error: "Customer not found." };
  }
  if (args.vehicleId) {
    const { data: vehicle } = await admin
      .from("vehicles")
      .select("id, organization_id, customer_id")
      .eq("id", args.vehicleId)
      .maybeSingle();
    type V = { id: string; organization_id: string; customer_id: string };
    const v = vehicle as V | null;
    if (!v || v.organization_id !== ctx.organization.id) {
      return { error: "Vehicle not found." };
    }
    if (v.customer_id !== args.customerId) {
      return { error: "Vehicle does not belong to the selected customer." };
    }
  }

  // If a videoPath was provided, sanity-check it landed in storage.
  if (args.videoPath) {
    const exists = await videoObjectExists(args.videoPath);
    if (!exists) return { error: "Video upload not found — please retry." };
  }

  const { subtotal, vat, total } = computeTotals(args.items);

  // Look up the org-level default validity if the caller didn't override.
  let validityDays = args.expiresInDays;
  if (!validityDays) {
    const { data: org } = await admin
      .from("organizations")
      .select("quote_validity_days")
      .eq("id", ctx.organization.id)
      .maybeSingle();
    validityDays = Number((org as { quote_validity_days?: number } | null)?.quote_validity_days ?? 30);
  }
  if (!Number.isFinite(validityDays) || validityDays < 1 || validityDays > 365) validityDays = 30;

  const quoteId = args.quoteId ?? crypto.randomUUID();
  const sendNow = !!args.sendImmediately;

  const insertPayload: Record<string, unknown> = {
    id: quoteId,
    location_id: ctx.location.id,
    organization_id: ctx.organization.id,
    customer_id: args.customerId,
    vehicle_id: args.vehicleId ?? null,
    created_by: ctx.user.id,
    title: args.title?.trim() || null,
    description: args.description?.trim() || null,
    customer_message: args.customerMessage?.trim() || null,
    video_path: args.videoPath ?? null,
    video_mime: args.videoMime ?? null,
    video_size_bytes: args.videoSizeBytes ?? null,
    subtotal,
    vat_rate: VAT_RATE,
    vat_amount: vat,
    total,
    status: sendNow ? "pending" : "draft",
  };

  let customerUrl: string | undefined;
  let token: string | undefined;

  if (sendNow) {
    token = generateQuoteToken();
    const slug = generateStandaloneQuoteSlug();
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();
    insertPayload.token_hash = hashQuoteToken(token);
    insertPayload.slug = slug;
    insertPayload.expires_at = expiresAt;
    customerUrl = tenantQuoteUrl(ctx.location.slug, slug, token);
  }

  const { error: insertErr } = await admin.from("standalone_quotes").insert(insertPayload);
  if (insertErr) {
    if (args.videoPath) await removeVideoObject(args.videoPath);
    return { error: `Failed to save quote: ${insertErr.message}` };
  }

  const itemRows = args.items.map((it, idx) => ({
    quote_id: quoteId,
    description: it.description.trim(),
    type: it.type,
    quantity: it.quantity,
    unit_price: it.unit_price,
    product_id: it.product_id ?? null,
    sort_order: idx,
  }));
  const { error: itemsErr } = await admin.from("standalone_quote_items").insert(itemRows);
  if (itemsErr) {
    await admin.from("standalone_quotes").delete().eq("id", quoteId);
    if (args.videoPath) await removeVideoObject(args.videoPath);
    return { error: `Failed to save items: ${itemsErr.message}` };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "standalone_quote.create",
    entityType: "standalone_quote",
    entityId: quoteId,
    metadata: { customer_id: args.customerId, vehicle_id: args.vehicleId ?? null, total, items: args.items.length, draft: !sendNow },
  });

  revalidatePath("/staff/quotes");
  revalidatePath(`/staff/quotes/${quoteId}`);

  return { success: true, quoteId, customerUrl, total };
}

// ---------------------------------------------------------------------------
// sendStandaloneQuoteWithToken — used when staff finalises a draft. Mints the
// token + slug + expires_at, dispatches email + SMS, transitions to pending.
// For sending fresh: caller uses createStandaloneQuote with sendImmediately=true
// and gets the customerUrl back directly.
// ---------------------------------------------------------------------------
export type SendStandaloneResult =
  | { error: string }
  | { success: true; channels: string[]; customerUrl: string };

export async function sendStandaloneQuoteDraft(
  quoteId: string,
): Promise<SendStandaloneResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  type DraftRow = {
    id: string;
    location_id: string;
    status: string;
    total: number;
    title: string | null;
    customer_message: string | null;
    customer: { full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: { registration: string | null } | null;
  };
  const { data } = await admin
    .from("standalone_quotes")
    .select("id, location_id, status, total, title, customer_message, customer:customers(full_name, email, phone), vehicle:vehicles(registration)")
    .eq("id", quoteId)
    .maybeSingle();
  const q = data as DraftRow | null;
  if (!q || q.location_id !== ctx.location.id) return { error: "Quote not found." };
  if (q.status !== "draft") return { error: "Quote can only be sent from draft." };

  const customer = q.customer;
  if (!customer?.email && !customer?.phone) {
    return { error: "Customer has no email or phone — cannot notify." };
  }

  // Look up validity-days default to compute expiry, plus the active branch's
  // address so the customer's quote names where it came from.
  const [{ data: org }, { data: locRow }] = await Promise.all([
    admin
      .from("organizations")
      .select("quote_validity_days, name")
      .eq("id", ctx.organization.id)
      .maybeSingle(),
    admin.from("locations").select("address").eq("id", ctx.location.id).maybeSingle(),
  ]);
  type OrgRow = { quote_validity_days: number | null; name: string };
  const orgRow = org as OrgRow | null;
  const locationAddress = (locRow as { address: string | null } | null)?.address ?? null;
  const validityDays = Number(orgRow?.quote_validity_days ?? 30);

  const token = generateQuoteToken();
  const slug = generateStandaloneQuoteSlug();
  const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000).toISOString();

  const { error: updateErr } = await admin
    .from("standalone_quotes")
    .update({
      status: "pending",
      token_hash: hashQuoteToken(token),
      slug,
      expires_at: expiresAt,
      sent_at: new Date().toISOString(),
    })
    .eq("id", quoteId)
    .eq("status", "draft");
  if (updateErr) return { error: updateErr.message };

  const url = tenantQuoteUrl(ctx.location.slug, slug, token);
  const result = await dispatchStandaloneNotification({
    customer,
    vehicleReg: q.vehicle?.registration ?? null,
    title: q.title,
    total: q.total,
    garageName: orgRow?.name ?? ctx.organization.name,
    locationName: ctx.location.name,
    address: locationAddress,
    url,
  });

  if (result.channels.length === 0) {
    // Roll back so staff can fix contact details + retry.
    await admin
      .from("standalone_quotes")
      .update({ status: "draft", token_hash: null, slug: null, expires_at: null, sent_at: null })
      .eq("id", quoteId);
    return { error: "Failed to send via any channel." };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "standalone_quote.send",
    entityType: "standalone_quote",
    entityId: quoteId,
    metadata: { channels: result.channels, total: q.total },
  });

  revalidatePath("/staff/quotes");
  revalidatePath(`/staff/quotes/${quoteId}`);
  return { success: true, channels: result.channels, customerUrl: url };
}

// Used by createStandaloneQuote(sendImmediately=true) — mirrors above but
// the row was just inserted with token_hash + slug + expires_at all in place.
// Caller passes the raw token captured in memory at insert time.
export async function sendFreshStandaloneQuote(
  quoteId: string,
  token: string,
): Promise<SendStandaloneResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  type Row = {
    id: string;
    location_id: string;
    status: string;
    slug: string | null;
    total: number;
    title: string | null;
    customer: { full_name: string | null; email: string | null; phone: string | null } | null;
    vehicle: { registration: string | null } | null;
  };
  const { data } = await admin
    .from("standalone_quotes")
    .select("id, location_id, status, slug, total, title, customer:customers(full_name, email, phone), vehicle:vehicles(registration)")
    .eq("id", quoteId)
    .maybeSingle();
  const q = data as Row | null;
  if (!q || q.location_id !== ctx.location.id) return { error: "Quote not found." };
  if (q.status !== "pending" || !q.slug) return { error: "Quote not in a sendable state." };

  const customer = q.customer;
  if (!customer?.email && !customer?.phone) {
    return { error: "Customer has no email or phone — cannot notify." };
  }

  const { data: locRow } = await admin
    .from("locations")
    .select("address")
    .eq("id", ctx.location.id)
    .maybeSingle();
  const locationAddress = (locRow as { address: string | null } | null)?.address ?? null;

  const url = tenantQuoteUrl(ctx.location.slug, q.slug, token);
  const result = await dispatchStandaloneNotification({
    customer,
    vehicleReg: q.vehicle?.registration ?? null,
    title: q.title,
    total: q.total,
    garageName: ctx.organization.name,
    locationName: ctx.location.name,
    address: locationAddress,
    url,
  });

  if (result.channels.length === 0) return { error: "Failed to send via any channel." };

  await admin
    .from("standalone_quotes")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", quoteId);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "standalone_quote.send",
    entityType: "standalone_quote",
    entityId: quoteId,
    metadata: { channels: result.channels, total: q.total },
  });

  revalidatePath("/staff/quotes");
  revalidatePath(`/staff/quotes/${quoteId}`);
  return { success: true, channels: result.channels, customerUrl: url };
}

async function dispatchStandaloneNotification(args: {
  customer: { full_name: string | null; email: string | null; phone: string | null };
  vehicleReg: string | null;
  title: string | null;
  total: number;
  garageName: string;
  locationName: string | null;
  address: string | null;
  url: string;
}): Promise<{ channels: string[] }> {
  const { customer, vehicleReg, title, total, garageName, locationName, address, url } = args;
  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(total);
  const refSuffix = vehicleReg ? ` for ${vehicleReg}` : "";
  // Name the issuing branch (+ address) so the customer knows who/where it's from.
  const identity = { orgName: garageName, locationName, address };
  const where = garageLabel(identity);

  const channels: string[] = [];

  if (customer.email) {
    const subject = `Quote from ${where}`;
    const text = `Hi ${firstName},\n\n${title ? title + "\n\n" : ""}Here's your quote${refSuffix}: ${totalFmt} (inc. VAT).\n\nReview the line items and approve or decline online.\n\n${garageLocationBlock(identity)}`;
    const result = await sendEmail({
      to: customer.email,
      subject,
      text,
      cta: { url, label: "View quote" },
    });
    if (result.success) channels.push("email");
  }

  if (customer.phone) {
    const body = `Hi ${firstName}, ${garageLocationInline(identity)} has sent you a quote${refSuffix}: ${totalFmt}. View + decide: ${url}`;
    const result = await sendSms({ to: customer.phone, body });
    if (result.success) channels.push("sms");
  }

  return { channels };
}

// ---------------------------------------------------------------------------
// updateStandaloneQuoteDraft — edit title/description/items on a draft.
// Refuses when status !== 'draft'.
// ---------------------------------------------------------------------------
export type UpdateDraftResult = { error: string } | { success: true };

export async function updateStandaloneQuoteDraft(args: {
  quoteId: string;
  title?: string;
  description?: string;
  customerMessage?: string;
  items?: StandaloneQuoteItemInput[];
}): Promise<UpdateDraftResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data } = await admin
    .from("standalone_quotes")
    .select("id, location_id, status")
    .eq("id", args.quoteId)
    .maybeSingle();
  type Row = { id: string; location_id: string; status: string };
  const q = data as Row | null;
  if (!q || q.location_id !== ctx.location.id) return { error: "Quote not found." };
  if (q.status !== "draft") return { error: "Only draft quotes can be edited." };

  const updates: Record<string, unknown> = {};
  if (args.title !== undefined) updates.title = args.title?.trim() || null;
  if (args.description !== undefined) updates.description = args.description?.trim() || null;
  if (args.customerMessage !== undefined) updates.customer_message = args.customerMessage?.trim() || null;

  if (args.items) {
    if (!args.items.length) return { error: "At least one line item required." };
    for (const it of args.items) {
      if (!it.description?.trim()) return { error: "Every item needs a description." };
      if (!["part", "labour", "other"].includes(it.type)) return { error: "Invalid item type." };
      if (!Number.isFinite(it.quantity) || it.quantity <= 0) return { error: "Quantity must be > 0." };
      if (!Number.isFinite(it.unit_price) || it.unit_price < 0) return { error: "Unit price must be >= 0." };
    }
    const { subtotal, vat, total } = computeTotals(args.items);
    updates.subtotal = subtotal;
    updates.vat_amount = vat;
    updates.total = total;

    await admin.from("standalone_quote_items").delete().eq("quote_id", args.quoteId);
    const itemRows = args.items.map((it, idx) => ({
      quote_id: args.quoteId,
      description: it.description.trim(),
      type: it.type,
      quantity: it.quantity,
      unit_price: it.unit_price,
      product_id: it.product_id ?? null,
      sort_order: idx,
    }));
    await admin.from("standalone_quote_items").insert(itemRows);
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("standalone_quotes").update(updates).eq("id", args.quoteId);
    if (error) return { error: error.message };
  }

  revalidatePath(`/staff/quotes/${args.quoteId}`);
  return { success: true };
}

// ---------------------------------------------------------------------------
// cancelStandaloneQuote — pending/draft → cancelled. Cleans up storage object.
// ---------------------------------------------------------------------------
export type CancelStandaloneResult = { error: string } | { success: true };

export async function cancelStandaloneQuote(quoteId: string): Promise<CancelStandaloneResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  type Row = { id: string; location_id: string; status: string; video_path: string | null };
  const { data } = await admin
    .from("standalone_quotes")
    .select("id, location_id, status, video_path")
    .eq("id", quoteId)
    .maybeSingle();
  const q = data as Row | null;
  if (!q || q.location_id !== ctx.location.id) return { error: "Quote not found." };
  if (q.status !== "pending" && q.status !== "draft") return { error: "Quote can no longer be cancelled." };

  const { error } = await admin
    .from("standalone_quotes")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("id", quoteId)
    .in("status", ["pending", "draft"]);
  if (error) return { error: error.message };

  if (q.video_path) await removeVideoObject(q.video_path);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "standalone_quote.cancel",
    entityType: "standalone_quote",
    entityId: quoteId,
    metadata: {},
  });

  revalidatePath("/staff/quotes");
  revalidatePath(`/staff/quotes/${quoteId}`);
  return { success: true };
}
