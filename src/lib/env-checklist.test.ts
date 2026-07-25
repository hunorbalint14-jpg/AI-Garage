import { describe, it, expect } from "vitest";
import { checkEnv, ENV_VARS, ENV_ONE_OF } from "./env-checklist";

const coreNames = ENV_VARS.filter((v) => v.level === "core").map((v) => v.name);

function envWith(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

describe("checkEnv", () => {
  it("flags every core var as missing on an empty env", () => {
    const r = checkEnv(envWith({}));
    expect(r.coreMissing.sort()).toEqual([...coreNames].sort());
  });

  it("treats empty/whitespace as missing", () => {
    const r = checkEnv(envWith({ NEXT_PUBLIC_SUPABASE_URL: "  ", SUPABASE_SERVICE_ROLE_KEY: "" }));
    expect(r.coreMissing).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(r.coreMissing).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("passes core when all core vars are set", () => {
    const full = Object.fromEntries(coreNames.map((n) => [n, "x"]));
    expect(checkEnv(envWith(full)).coreMissing).toEqual([]);
  });

  it("warns about the synthetic-monitoring vars — a silent skip is the failure mode (#445)", () => {
    // CANARY_ORG_SLUG unset makes the golden-path cron no-op with a success
    // response, so nothing surfaces the fact that the money path is untested.
    const r = checkEnv(envWith({}));
    expect(r.featureMissing.map((v) => v.name)).toContain("CANARY_ORG_SLUG");
    const canary = ENV_VARS.find((v) => v.name === "CANARY_ORG_SLUG");
    expect(canary?.group).toBe("Synthetic monitoring");
    expect(canary?.level).toBe("feature");
  });

  it("every var carries a failure mode — a checklist row with no 'so what' is noise", () => {
    for (const v of ENV_VARS) {
      expect(v.ifMissing, `${v.name} has no ifMissing`).toBeTruthy();
    }
  });

  it("accepts either Upstash pair for the rate-limit one-of", () => {
    expect(checkEnv(envWith({})).oneOfMissing.some((g) => g.group.includes("Upstash"))).toBe(true);
    const redis = checkEnv(envWith({ UPSTASH_REDIS_REST_URL: "u", UPSTASH_REDIS_REST_TOKEN: "t" }));
    expect(redis.oneOfMissing.some((g) => g.group.includes("Upstash"))).toBe(false);
    const kv = checkEnv(envWith({ UPSTASH_KV_REST_API_URL: "u", UPSTASH_KV_REST_API_TOKEN: "t" }));
    expect(kv.oneOfMissing.some((g) => g.group.includes("Upstash"))).toBe(false);
  });

  it("does not accept a half-set Upstash pair", () => {
    const half = checkEnv(envWith({ UPSTASH_REDIS_REST_URL: "u" }));
    expect(half.oneOfMissing.some((g) => g.group.includes("Upstash"))).toBe(true);
  });

  it("flags dev-only vars that leak into prod", () => {
    expect(checkEnv(envWith({ DEMO_MOT_FIXTURES: "1" })).devOnlySet).toContain("DEMO_MOT_FIXTURES");
  });

  it("lists ANTHROPIC_API_KEY as a feature var (SDK reads it implicitly)", () => {
    expect(ENV_VARS.some((v) => v.name === "ANTHROPIC_API_KEY" && v.level === "feature")).toBe(true);
  });
});
