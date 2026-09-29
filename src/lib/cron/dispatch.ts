// How /api/cron/tick calls the routes it fans out to (per-branch tasks and the
// daily platform passes).
//
// The tick used to call `new URL(request.url).origin` — the host Vercel Cron
// invoked it on, which is the *.vercel.app deployment URL. Those URLs sit
// behind Vercel Authentication (Deployment Protection): an unauthenticated
// request gets a 302 to vercel.com/sso-api, `fetch` followed it, and the login
// page answered 200. So every dispatch "succeeded" while no child route ever
// ran — reminders, dunning, review requests, booking confirmations, digests,
// tyre care and the four daily passes, silently, from June 2026 until this fix.
//
// Two rules keep that from recurring:
//   1. Dispatch to the public root domain (never protected), not to whatever
//      host the tick happened to be invoked on.
//   2. Never follow redirects, and only count a JSON 2xx as success — every
//      cron route answers JSON, so an HTML 200 is someone else's page.

/** Public origin the cron children are called on, e.g. "https://ai-garage.co.uk". */
export function cronBaseUrl(fallbackOrigin: string, env: Record<string, string | undefined> = process.env): string {
  const override = env.CRON_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  const root = env.NEXT_PUBLIC_ROOT_DOMAIN?.trim();
  if (!root) return fallbackOrigin;
  const local = root.includes("localtest") || root.includes("localhost") || root.startsWith("127.");
  return `${local ? "http" : "https"}://${root}`;
}

export type DispatchResult = { ok: true; status: number } | { ok: false; status: number; error: string };

/** Classify a child-route response. Pure, so the rules are unit-tested. */
export function classifyDispatch(status: number, contentType: string | null, location: string | null): DispatchResult {
  if (status >= 300 && status < 400) {
    return { ok: false, status, error: `redirected (HTTP ${status}${location ? ` → ${location.slice(0, 80)}` : ""})` };
  }
  if (status < 200 || status >= 300) return { ok: false, status, error: `HTTP ${status}` };
  if (!contentType?.includes("application/json")) {
    return { ok: false, status, error: `HTTP ${status} but not JSON (${contentType ?? "no content-type"}) — not a cron route` };
  }
  return { ok: true, status };
}

/** Call one cron child route with the cron secret. Never throws. */
export async function dispatchCron(url: string, secret: string): Promise<DispatchResult> {
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      redirect: "manual",
    });
    return classifyDispatch(res.status, res.headers.get("content-type"), res.headers.get("location"));
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
}
