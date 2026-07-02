"use server";

import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import { hasPermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";
import { logAudit } from "@/lib/audit";
import {
  generateQuoteToken,
  generateQuoteSlug,
  hashQuoteToken,
  tenantQuoteUrl,
} from "@/lib/quote-links";
import {
  QUOTE_VIDEO_MAX_BYTES,
  isAllowedVideoMime,
  createUploadUrl,
  videoObjectExists,
  videoPath,
  removeVideoObject,
} from "@/lib/quote-storage";
import { computeTotals, DEFAULT_VAT_RATE } from "@/lib/quote-service";

export type QuoteItemInput = {
  description: string;
  type: "part" | "labour" | "other";
  quantity: number;
  unit_price: number;
  product_id?: string | null;
};


// ---------------------------------------------------------------------------
// Step 1 — mint a signed upload URL. Client calls this first, PUTs the file
// directly to Supabase Storage, then calls createQuote() with the storage path.
// ---------------------------------------------------------------------------
export type PrepareUploadResult =
  | { error: string }
  | { success: true; uploadUrl: string; path: string; quoteId: string };

export async function prepareQuoteUpload(
  jobId: string,
  fileMime: string,
  fileSizeBytes: number,
  fileExt: string,
): Promise<PrepareUploadResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  if (!isAllowedVideoMime(fileMime)) {
    return { error: "Unsupported video format. Use MP4, MOV, or WebM." };
  }
  if (fileSizeBytes > QUOTE_VIDEO_MAX_BYTES) {
    return { error: "Video too large (max 80 MB). Shorter clip needed." };
  }

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, status")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.location_id !== ctx.location.id) return { error: "Job not found." };
  if (job.status !== "open") return { error: "Cannot raise a quote on a closed job." };

  // Pre-generate the quote id so the storage path is stable across mint + insert.
  // The row is only created later in createQuote — we just reserve the path now.
  const quoteId = crypto.randomUUID();
  const path = videoPath(ctx.location.id, jobId, quoteId, fileExt);
  const upload = await createUploadUrl(path);
  if ("error" in upload) return { error: upload.error };

  return { success: true, uploadUrl: upload.url, path, quoteId };
}

// ---------------------------------------------------------------------------
// Step 2 — after successful upload, create the quote row + snapshot items.
// Returns the customer URL so the staff UI can display + use it.
// ---------------------------------------------------------------------------
export type CreateQuoteResult =
  | { error: string }
  // customerUrl is only returned when the quote was created pending (a token was
  // minted); a draft has no token/link yet.
  | { success: true; quoteId: string; customerUrl?: string; total: number };

export async function createQuote(args: {
  jobId: string;
  quoteId?: string;
  // Video is optional on all quotes now.
  videoPath?: string | null;
  videoMime?: string | null;
  videoSizeBytes?: number | null;
  videoDurationSeconds?: number | null;
  title?: string;
  description?: string;
  items: QuoteItemInput[];
  expiresInDays?: number;
  // Save without sending: status='draft', no token/link. Sent later from the
  // central quote detail via sendQuoteDraft.
  asDraft?: boolean;
}): Promise<CreateQuoteResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_draft")) return { error: "Permission denied." };
  const admin = createAdminClient();

  if (!args.items.length) return { error: "Add at least one item to the quote." };
  for (const it of args.items) {
    if (!it.description?.trim()) return { error: "Every item needs a description." };
    if (!["part", "labour", "other"].includes(it.type)) return { error: "Invalid item type." };
    if (!Number.isFinite(it.quantity) || it.quantity <= 0) return { error: "Quantity must be greater than 0." };
    if (!Number.isFinite(it.unit_price) || it.unit_price < 0) return { error: "Unit price must be 0 or greater." };
  }

  const { data: job } = await admin
    .from("jobs")
    .select("id, location_id, status")
    .eq("id", args.jobId)
    .maybeSingle();
  if (!job || (job as { location_id: string }).location_id !== ctx.location.id) {
    return { error: "Job not found." };
  }
  if ((job as { status: string }).status !== "open") {
    return { error: "Cannot raise a quote on a closed job." };
  }

  // Optional video — verify the upload only when one was attached.
  if (args.videoPath) {
    const exists = await videoObjectExists(args.videoPath);
    if (!exists) return { error: "Video upload not found — please retry." };
  }

  const { subtotal, vat, total } = computeTotals(args.items);
  const quoteId = args.quoteId ?? crypto.randomUUID();
  const asDraft = !!args.asDraft;

  const insert: Record<string, unknown> = {
    id: quoteId,
    quote_type: "job",
    job_id: args.jobId,
    organization_id: ctx.organization.id,
    location_id: ctx.location.id,
    created_by: ctx.user.id,
    title: args.title?.trim() || null,
    description: args.description?.trim() || null,
    video_path: args.videoPath ?? null,
    video_mime: args.videoMime ?? null,
    video_size_bytes: args.videoSizeBytes ?? null,
    video_duration_seconds: args.videoDurationSeconds ?? null,
    subtotal,
    vat_rate: DEFAULT_VAT_RATE,
    vat_amount: vat,
    total,
    status: asDraft ? "draft" : "pending",
  };

  let customerUrl: string | undefined;
  let expiresAt: string | null = null;
  if (!asDraft) {
    const token = generateQuoteToken();
    const slug = generateQuoteSlug();
    const days = args.expiresInDays ?? 7;
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    insert.token_hash = hashQuoteToken(token);
    insert.slug = slug;
    insert.expires_at = expiresAt;
    customerUrl = tenantQuoteUrl(ctx.location.slug, slug, token);
  }

  const { error: insertErr } = await admin.from("quotes").insert(insert);
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
  const { error: itemsErr } = await admin.from("quote_items").insert(itemRows);
  if (itemsErr) {
    await admin.from("quotes").delete().eq("id", quoteId);
    if (args.videoPath) await removeVideoObject(args.videoPath);
    return { error: `Failed to save items: ${itemsErr.message}` };
  }

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "quote.create",
    entityType: "job_quote",
    entityId: quoteId,
    metadata: { job_id: args.jobId, total, items: args.items.length, draft: asDraft, expires_at: expiresAt },
  });

  revalidatePath(`/staff/jobs/${args.jobId}`);
  return { success: true, quoteId, customerUrl, total };
}

// ---------------------------------------------------------------------------
// Step 3 — send notification (email + SMS). The raw token is mint-once
// (only the sha256 hash is stored), so the staff UI passes it back here
// from the createQuote response. To resend after the token has been
// forgotten, staff must cancel + recreate.
// ---------------------------------------------------------------------------
export type SendQuoteResult =
  | { error: string }
  | { success: true; channels: string[] };

export async function sendQuoteWithToken(
  quoteId: string,
  token: string,
): Promise<SendQuoteResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  type QuoteWithCustomer = {
    id: string;
    job_id: string;
    location_id: string;
    slug: string;
    title: string | null;
    description: string | null;
    total: number;
    status: string;
    job: {
      customer: { full_name: string | null; email: string | null; phone: string | null } | null;
      vehicle: { registration: string | null } | null;
    } | null;
  };

  const { data: q } = await admin
    .from("quotes")
    .select(
      "id, job_id, location_id, slug, title, description, total, status, job:jobs(customer:customers(full_name, email, phone), vehicle:vehicles(registration))",
    )
    .eq("id", quoteId)
    .maybeSingle();
  const quote = q as QuoteWithCustomer | null;
  if (!quote || quote.location_id !== ctx.location.id) return { error: "Quote not found." };
  if (quote.status !== "pending") return { error: "Quote is no longer pending." };

  const customer = quote.job?.customer;
  if (!customer?.email && !customer?.phone) {
    return { error: "Customer has no email or phone — cannot notify." };
  }

  const url = tenantQuoteUrl(ctx.location.slug, quote.slug, token);
  const garageName = ctx.organization.name;
  const firstName = customer.full_name?.split(" ")[0] ?? "there";
  const reg = quote.job?.vehicle?.registration ?? "your vehicle";
  const totalFmt = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(quote.total);

  const channels: string[] = [];

  if (customer.email) {
    const subject = `Additional work found — quote from ${garageName}`;
    const text = `Hi ${firstName},\n\nWhile working on ${reg}, we found extra work that needs your approval before we continue.\n\n${quote.title ? quote.title + "\n\n" : ""}${quote.description ? quote.description + "\n\n" : ""}Total (inc. VAT): ${totalFmt}\n\nWatch a short video showing what we found, then approve or decline.`;
    const result = await sendEmail({
      to: customer.email,
      subject,
      text,
      cta: { url, label: "View video & quote" },
    });
    if (result.success) channels.push("email");
  }

  if (customer.phone) {
    const body = `Hi ${firstName}, ${garageName} found extra work on ${reg}: ${totalFmt}. View video + decide: ${url}`;
    const result = await sendSms({ to: customer.phone, body });
    if (result.success) channels.push("sms");
  }

  if (channels.length === 0) {
    return { error: "Failed to send via any channel." };
  }

  await admin
    .from("quotes")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", quoteId);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "quote.send",
    entityType: "job_quote",
    entityId: quoteId,
    metadata: { job_id: quote.job_id, channels, total: quote.total },
  });

  revalidatePath(`/staff/jobs/${quote.job_id}`);
  return { success: true, channels };
}

// ---------------------------------------------------------------------------
// Cancel a pending quote. Stops the customer link working (status check
// rejects everything except `pending`) and cleans up the video object.
// ---------------------------------------------------------------------------
export type CancelQuoteResult = { error: string } | { success: true };

export async function cancelQuote(quoteId: string): Promise<CancelQuoteResult> {
  const ctx = await requireStaffContext();
  if (!hasPermission(ctx, "quotes_send")) return { error: "Permission denied." };
  const admin = createAdminClient();

  const { data: q } = await admin
    .from("quotes")
    .select("id, job_id, location_id, status, video_path")
    .eq("id", quoteId)
    .maybeSingle();
  type Row = { id: string; job_id: string; location_id: string; status: string; video_path: string };
  const quote = q as Row | null;
  if (!quote || quote.location_id !== ctx.location.id) return { error: "Quote not found." };
  if (quote.status !== "pending") return { error: "Quote can no longer be cancelled." };

  const { error } = await admin
    .from("quotes")
    .update({ status: "cancelled", responded_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("status", "pending");
  if (error) return { error: error.message };

  await removeVideoObject(quote.video_path);

  await logAudit({
    organizationId: ctx.organization.id,
    actorUserId: ctx.user.id,
    actorEmail: ctx.user.email ?? null,
    action: "quote.cancel",
    entityType: "job_quote",
    entityId: quoteId,
    metadata: { job_id: quote.job_id },
  });

  revalidatePath(`/staff/jobs/${quote.job_id}`);
  return { success: true };
}
