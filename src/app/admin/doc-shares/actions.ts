"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdminUser } from "@/lib/platform-admin";
import {
  createShare,
  revokeShare,
  shareUrl,
  type CreateShareInput,
} from "@/lib/doc-shares";
import { logAudit } from "@/lib/audit";

// Doc keys allowed from the UI. Must match keys in src/app/docs/[slug]/route.ts.
const ALLOWED_DOC_KEYS = ["technical", "userguide"] as const;
type AllowedDocKey = (typeof ALLOWED_DOC_KEYS)[number];

async function requirePlatformAdmin(): Promise<{ id: string; email?: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!(await isPlatformAdminUser(user))) redirect("/admin/login");
  return user!;
}

export type CreateShareActionResult =
  | { ok: true; url: string; slug: string; token: string }
  | { ok: false; error: string };

export async function createShareAction(formData: FormData): Promise<CreateShareActionResult> {
  const actor = await requirePlatformAdmin();

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
    createdBy: actor.id,
  };

  let result;
  try {
    result = await createShare(input);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create share." };
  }

  // Share links serve from the apex, not the admin host — strip the reserved
  // subdomain when NEXT_PUBLIC_ROOT_DOMAIN isn't configured.
  const h = await headers();
  const host = h.get("host") ?? "ai-garage.co.uk";
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? host.replace(/^admin\./, "");
  const url = shareUrl(rootDomain, result.share.slug, result.token);

  await logAudit({
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    action: "doc_share.mint",
    entityType: "doc_share",
    entityId: result.share.id,
    metadata: {
      doc_key: docKey,
      slug: result.share.slug,
      label,
      expires_at: result.share.expires_at,
      max_views: result.share.max_views,
    },
  });

  revalidatePath("/admin/doc-shares");
  return { ok: true, url, slug: result.share.slug, token: result.token };
}

export async function revokeShareAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requirePlatformAdmin();
  try {
    await revokeShare({ id, revokedBy: actor.id });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to revoke." };
  }
  await logAudit({
    actorUserId: actor.id,
    actorEmail: actor.email ?? null,
    action: "doc_share.revoke",
    entityType: "doc_share",
    entityId: id,
  });
  revalidatePath("/admin/doc-shares");
  return { ok: true };
}
