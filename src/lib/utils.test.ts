import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn (Tailwind class merger)", () => {
  it("merges plain strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("dedupes Tailwind classes by group (last wins)", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm text-lg")).toBe("text-lg");
  });

  it("drops falsy values", () => {
    expect(cn("a", null, undefined, false, "b")).toBe("a b");
  });

  it("supports conditional objects (clsx style)", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });
});
