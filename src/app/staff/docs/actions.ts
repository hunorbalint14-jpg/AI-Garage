"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireStaffContext } from "@/lib/staff-context";
import {
  createShare,
  revokeShare,
  shareUrl,
  type CreateShareInput,
} from "@/lib/doc-shares";

// Doc keys allowed from the UI. Must match keys in src/app/docs/[slug]/route.ts.
const ALLOWED_DOC_KEYS = ["technical"] as const;
type AllowedDocKey = (typeof ALLOWED_DOC_KEYS)[number];

export type CreateShareActionResult =
  | { ok: true; url: string; slug: string; token: string }
  | { ok: false; error: string };

export async function createShareAction(formData: FormData): Promise<CreateShareActionResult> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") {
    return { ok: false, error: "Only org owners can mint share links." };
  }

  const docKey = String(formData.get("doc_key") ?? "");
  if (!ALLOWED_DOC_KEYS.includes(docKey as AllowedDocKey)) {
    return { ok: false, error: "Unknown document." };
  }

  const label = (formData.get("label") as string | null)?.trim() || null;

  const expiresInDaysRaw = formData.get("expires_in_days");
  let expiresAt: Date | null = null;
  if (expiresInDaysRaw && expiresInDaysRaw !== "never") {
    const days = parseInt(String(expiresInDaysRaw), 10);
    if (Number.isFinite(days) && days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d;
    }
  }

  const maxViewsRaw = formData.get("max_views");
  let maxViews: number | null = null;
  if (maxViewsRaw && maxViewsRaw !== "") {
    const n = parseInt(String(maxViewsRaw), 10);
    if (Number.isFinite(n) && n > 0) maxViews = n;
  }

  const input: CreateShareInput = {
    docKey,
    label,
    expiresAt,
    maxViews,
    organizationId: ctx.organization.id,
    createdBy: ctx.user.id,
  };

  let result;
  try {
    result = await createShare(input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create share." };
  }

  // Build the absolute URL using the host the staff request came in on, so
  // links work in dev (localtest.me), staging and prod without a config change.
  const h = await headers();
  const host = h.get("host") ?? "ai-garage.co.uk";
  // For external sharing we want the apex, not the tenant subdomain.
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? host;
  const url = shareUrl(rootDomain, result.share.slug, result.token);

  revalidatePath("/staff/docs");
  return { ok: true, url, slug: result.share.slug, token: result.token };
}

export async function revokeShareAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") {
    return { ok: false, error: "Only org owners can revoke share links." };
  }
  try {
    await revokeShare({
      id,
      revokedBy: ctx.user.id,
      organizationId: ctx.organization.id,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to revoke." };
  }
  revalidatePath("/staff/docs");
  return { ok: true };
}
