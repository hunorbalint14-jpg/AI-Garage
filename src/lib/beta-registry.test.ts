import { describe, expect, it } from "vitest";
import { BETA_SURFACES, daysLive } from "./beta-registry";
import { NAV_MODULES } from "@/components/staff/staff-modules";

// The registry and the actual chips must move together: a nav item wearing
// `beta: true` needs a registry entry (or the tracker lies by omission), and
// a registry entry pointing at a nav item needs the chip to still exist (or
// the tracker shows graduated surfaces as live).

function navBetaKeys(): string[] {
  const keys: string[] = [];
  for (const mod of NAV_MODULES) {
    for (const item of mod.items) {
      if (item.beta) keys.push(item.key);
    }
  }
  return keys.sort();
}

describe("beta registry ↔ nav chips", () => {
  it("every beta nav flag has a registry entry", () => {
    const registryNavKeys = BETA_SURFACES.flatMap((s) => ("navKey" in s.chip ? [s.chip.navKey] : [])).sort();
    expect(navBetaKeys()).toEqual(registryNavKeys);
  });

  it("keys unique; launch dates valid ISO", () => {
    const keys = BETA_SURFACES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of BETA_SURFACES) {
      expect(s.launchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(s.launchedOn).getTime())).toBe(false);
    }
  });

  it("daysLive floors whole days", () => {
    expect(daysLive("2026-07-01", new Date("2026-07-11T09:00:00Z"))).toBe(10);
    expect(daysLive("2026-07-11", new Date("2026-07-11T09:00:00Z"))).toBe(0);
  });
});
