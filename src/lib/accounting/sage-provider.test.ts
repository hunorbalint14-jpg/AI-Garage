import { describe, expect, it } from "vitest";
import { sageReference } from "./sage-provider";

describe("sageReference", () => {
  const uuid = "6a7b8c9d-1111-2222-3333-abcdefabcdef";

  it("is deterministic and stays under Sage's ~25-char reference cap", () => {
    const a = sageReference("AIG-", uuid);
    expect(a).toBe(sageReference("AIG-", uuid));
    expect(a).toBe("AIG-abcdefabcdef"); // prefix + last 12 hex of the uuid
    expect(a.length).toBeLessThanOrEqual(25);
    expect(sageReference("AIGCN-", uuid).length).toBeLessThanOrEqual(25);
  });

  it("differs across uuids and prefixes", () => {
    expect(sageReference("AIG-", uuid)).not.toBe(
      sageReference("AIG-", "6a7b8c9d-1111-2222-3333-abcdefabcd00"),
    );
    expect(sageReference("AIG-", uuid)).not.toBe(sageReference("AIGCN-", uuid));
  });
});
