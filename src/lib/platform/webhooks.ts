import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Record one inbound webhook delivery. Fire-and-forget — never throws, so it
// can't break the webhook handler's response to the provider.
export async function recordWebhookDelivery(
  admin: Admin,
  args: { provider: string; eventType?: string | null; ok: boolean; statusCode?: number | null; latencyMs?: number | null; error?: string | null },
): Promise<void> {
  try {
    await admin.from("webhook_deliveries").insert({
      provider: args.provider,
      event_type: args.eventType ?? null,
      ok: args.ok,
      status_code: args.statusCode ?? null,
      latency_ms: args.latencyMs ?? null,
      error: args.error ?? null,
    });
  } catch (err) {
    console.error("[webhooks] record failed", { provider: args.provider, err });
  }
}

export type WebhookHealth = {
  provider: string;
  delivered: number;
  failed: number;
  successPct: number;
  p95Ms: number | null;
};

// Per-provider delivery health over the last `hours` (default 24h).
export async function fetchWebhookHealth(hours = 24): Promise<WebhookHealth[]> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const { data } = await admin
    .from("webhook_deliveries")
    .select("provider, ok, latency_ms")
    .gte("received_at", since)
    .limit(50000);

  const byProvider = new Map<string, { total: number; ok: number; lat: number[] }>();
  for (const r of (data ?? []) as { provider: string; ok: boolean; latency_ms: number | null }[]) {
    const cur = byProvider.get(r.provider) ?? { total: 0, ok: 0, lat: [] };
    cur.total += 1;
    if (r.ok) cur.ok += 1;
    if (r.latency_ms != null) cur.lat.push(Number(r.latency_ms));
    byProvider.set(r.provider, cur);
  }

  return [...byProvider.entries()]
    .map(([provider, v]) => {
      const sorted = v.lat.sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null;
      return {
        provider,
        delivered: v.total,
        failed: v.total - v.ok,
        successPct: v.total ? Math.round((10000 * v.ok) / v.total) / 100 : 100,
        p95Ms: p95,
      };
    })
    .sort((a, b) => a.successPct - b.successPct);
}

// Overall 5xx/failure rate (%) across providers over the last `windowSecs` —
// used by the webhook_5xx_rate alert metric. Null when there were no deliveries.
export async function recentWebhookFailureRate(admin: Admin, windowSecs: number): Promise<number | null> {
  const since = new Date(Date.now() - windowSecs * 1000).toISOString();
  const { data } = await admin.from("webhook_deliveries").select("ok").gte("received_at", since).limit(50000);
  const rows = (data ?? []) as { ok: boolean }[];
  if (rows.length === 0) return null;
  const failed = rows.filter((r) => !r.ok).length;
  return (100 * failed) / rows.length;
}
