import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyDispatch, cronBaseUrl, dispatchCron } from "./dispatch";

describe("cronBaseUrl", () => {
  const fallback = "https://garage-abc123-team.vercel.app";

  it("uses the public root domain over the (protected) invocation host", () => {
    expect(cronBaseUrl(fallback, { NEXT_PUBLIC_ROOT_DOMAIN: "ai-garage.co.uk" })).toBe(
      "https://ai-garage.co.uk",
    );
  });

  it("uses http for local dev roots", () => {
    expect(cronBaseUrl(fallback, { NEXT_PUBLIC_ROOT_DOMAIN: "localtest.me:3000" })).toBe(
      "http://localtest.me:3000",
    );
  });

  it("honours an explicit CRON_BASE_URL, trailing slash trimmed", () => {
    expect(
      cronBaseUrl(fallback, {
        CRON_BASE_URL: "https://ops.example.com/",
        NEXT_PUBLIC_ROOT_DOMAIN: "ai-garage.co.uk",
      }),
    ).toBe("https://ops.example.com");
  });

  it("falls back to the invocation origin only when no root domain is configured", () => {
    expect(cronBaseUrl(fallback, {})).toBe(fallback);
  });
});

describe("classifyDispatch", () => {
  it("accepts a JSON 2xx", () => {
    expect(classifyDispatch(200, "application/json", null)).toEqual({ ok: true, status: 200 });
  });

  it("rejects the Deployment Protection redirect instead of following it", () => {
    const r = classifyDispatch(302, "text/plain", "https://vercel.com/sso-api?url=x");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/redirected \(HTTP 302 → https:\/\/vercel\.com\/sso-api/);
  });

  it("rejects an HTML 200 — that's a login or interstitial page, not a cron route", () => {
    const r = classifyDispatch(200, "text/html; charset=utf-8", null);
    expect(r.ok).toBe(false);
  });

  it("rejects error statuses", () => {
    expect(classifyDispatch(401, "application/json", null)).toMatchObject({ ok: false, error: "HTTP 401" });
    expect(classifyDispatch(500, "application/json", null)).toMatchObject({ ok: false, error: "HTTP 500" });
  });
});

describe("dispatchCron", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the bearer secret and never follows redirects", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await dispatchCron("https://ai-garage.co.uk/api/cron/reminders", "s3cret");
    expect(r).toEqual({ ok: true, status: 200 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://ai-garage.co.uk/api/cron/reminders",
      expect.objectContaining({ redirect: "manual", headers: { authorization: "Bearer s3cret" } }),
    );
  });

  it("reports a network error instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect(await dispatchCron("https://x/api/cron/a", "s")).toEqual({ ok: false, status: 0, error: "ECONNRESET" });
  });
});
