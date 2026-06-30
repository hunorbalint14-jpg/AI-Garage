import { NextResponse } from "next/server";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff-only diagnostic. Returns a redacted view of a quote row given its
// public slug so we can sanity-check what's actually in the database when
// a customer link reports "Quote not found". The raw token_hash is NOT
// returned — we only confirm it exists.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const ctx = await requireStaffContext();
  const { slug } = await params;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("quotes")
    .select("id, slug, status, expires_at, location_id, created_at, sent_at, video_path, token_hash")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        slug,
        found: false,
        error: { message: error.message, code: error.code },
      },
      { status: 200 },
    );
  }

  if (!data) {
    return NextResponse.json({ slug, found: false, error: null }, { status: 200 });
  }

  const row = data as {
    id: string;
    slug: string;
    status: string;
    expires_at: string;
    location_id: string;
    created_at: string;
    sent_at: string | null;
    video_path: string;
    token_hash: string;
  };

  // Only let the requester see the row if it belongs to their location.
  const sameTenant = row.location_id === ctx.location.id;

  return NextResponse.json({
    slug,
    found: true,
    sameTenant,
    id: sameTenant ? row.id : null,
    status: row.status,
    expires_at: row.expires_at,
    expired: new Date(row.expires_at) <= new Date(),
    created_at: row.created_at,
    sent_at: row.sent_at,
    has_token_hash: !!row.token_hash,
    token_hash_len: row.token_hash?.length ?? 0,
    video_path: sameTenant ? row.video_path : null,
  });
}
