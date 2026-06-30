import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// Quote token gating. Two source tables share the same /quote/[slug]?t=...
// customer route — DVI mid-job (job_quotes, slug "q-...") and standalone
// pre-job (standalone_quotes, slug "sq-..."). Tokens are random 32-byte
// values shown only via the generated link; DB only stores the sha256 hash.

export type QuoteVerifyReason =
  | "not_found"
  | "bad_token"
  | "expired"
  | "wrong_status";

export type QuoteSource = "job" | "standalone";

export type QuoteRecord = {
  id: string;
  source: QuoteSource;
  job_id: string | null;        // null for standalone quotes
  location_id: string;
  customer_id: string | null;   // null for DVI (look up via job)
  status: string;
  expires_at: string;
};

export type QuoteVerifyResult =
  | { ok: true; quote: QuoteRecord }
  | { ok: false; reason: QuoteVerifyReason };

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length !== bBuf.length || aBuf.length === 0) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function generateQuoteToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateQuoteSlug(): string {
  return `q-${crypto.randomBytes(5).toString("hex")}`;
}

export function generateStandaloneQuoteSlug(): string {
  return `sq-${crypto.randomBytes(5).toString("hex")}`;
}

export function hashQuoteToken(token: string): string {
  return hashToken(token);
}

function detectSource(slug: string): QuoteSource | null {
  if (slug.startsWith("sq-")) return "standalone";
  if (slug.startsWith("q-")) return "job";
  return null;
}

// Lookup by slug + verify the raw token against the stored hash. Routes by
// slug prefix to the right source table; defaults allowedStatuses to ["pending"]
// for the customer landing page. Outcome pages pass appropriate statuses.
export async function verifyQuoteAccess(
  slug: string,
  rawToken: string | null,
  allowedStatuses: string[] = ["pending"],
): Promise<QuoteVerifyResult> {
  if (!rawToken || rawToken.length < 16) {
    console.log("[verifyQuoteAccess] bad_token (length)", { slug, tokenLen: rawToken?.length ?? 0 });
    return { ok: false, reason: "bad_token" };
  }

  const source = detectSource(slug);
  if (!source) {
    console.warn("[verifyQuoteAccess] unknown slug prefix", { slug });
    return { ok: false, reason: "not_found" };
  }

  const admin = createAdminClient();

  if (source === "standalone") {
    const { data, error } = await admin
      .from("quotes")
      .select("id, location_id, customer_id, status, expires_at, token_hash, slug")
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.error("[verifyQuoteAccess] standalone db error", { slug, error: error.message, code: error.code });
      return { ok: false, reason: "not_found" };
    }
    if (!data) {
      console.warn("[verifyQuoteAccess] no standalone row for slug", { slug });
      return { ok: false, reason: "not_found" };
    }
    const row = data as {
      id: string;
      location_id: string;
      customer_id: string;
      status: string;
      expires_at: string | null;
      token_hash: string | null;
      slug: string;
    };

    if (!row.token_hash || !constantTimeEqualHex(hashToken(rawToken), row.token_hash)) {
      console.warn("[verifyQuoteAccess] standalone token hash mismatch", { slug, status: row.status });
      return { ok: false, reason: "bad_token" };
    }
    if (!row.expires_at || new Date(row.expires_at) <= new Date()) {
      console.warn("[verifyQuoteAccess] standalone expired", { slug, expires_at: row.expires_at });
      return { ok: false, reason: "expired" };
    }
    if (!allowedStatuses.includes(row.status)) {
      console.warn("[verifyQuoteAccess] standalone wrong_status", { slug, status: row.status, allowed: allowedStatuses });
      return { ok: false, reason: "wrong_status" };
    }

    return {
      ok: true,
      quote: {
        id: row.id,
        source: "standalone",
        job_id: null,
        location_id: row.location_id,
        customer_id: row.customer_id,
        status: row.status,
        expires_at: row.expires_at,
      },
    };
  }

  // source === "job"
  const { data, error } = await admin
    .from("quotes")
    .select("id, job_id, location_id, status, expires_at, token_hash, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[verifyQuoteAccess] job db error", { slug, error: error.message, code: error.code });
    return { ok: false, reason: "not_found" };
  }
  if (!data) {
    console.warn("[verifyQuoteAccess] no job_quotes row for slug", { slug });
    return { ok: false, reason: "not_found" };
  }
  const row = data as {
    id: string;
    job_id: string;
    location_id: string;
    status: string;
    expires_at: string;
    token_hash: string;
    slug: string;
  };

  if (!constantTimeEqualHex(hashToken(rawToken), row.token_hash)) {
    console.warn("[verifyQuoteAccess] job token hash mismatch", { slug, status: row.status });
    return { ok: false, reason: "bad_token" };
  }
  if (new Date(row.expires_at) <= new Date()) {
    console.warn("[verifyQuoteAccess] job expired", { slug, expires_at: row.expires_at });
    return { ok: false, reason: "expired" };
  }
  if (!allowedStatuses.includes(row.status)) {
    console.warn("[verifyQuoteAccess] job wrong_status", { slug, status: row.status, allowed: allowedStatuses });
    return { ok: false, reason: "wrong_status" };
  }

  return {
    ok: true,
    quote: {
      id: row.id,
      source: "job",
      job_id: row.job_id,
      location_id: row.location_id,
      customer_id: null,
      status: row.status,
      expires_at: row.expires_at,
    },
  };
}

// Build a tenant-aware quote URL: https://{slug}.{rootHost}/quote/{quoteSlug}?t={token}
export function tenantQuoteUrl(
  tenantSlug: string,
  quoteSlug: string,
  token: string,
): string {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "ai-garage.co.uk";
  const isLocal = rootDomain.includes("localtest") || rootDomain.includes("localhost");
  const proto = isLocal ? "http" : "https";
  return `${proto}://${tenantSlug}.${rootDomain}/quote/${quoteSlug}?t=${token}`;
}
