import { describe, it, expect } from "vitest";
import { costPence, AI_MODEL_PRICING } from "./ai-usage";

const HAIKU = "claude-haiku-4-5-20251001";

describe("costPence", () => {
  it("prices a known model from input + output tokens", () => {
    const { inputPerMTokPence, outputPerMTokPence } = AI_MODEL_PRICING[HAIKU];
    // 1M input + 1M output → exactly the per-MTok rates summed.
    expect(costPence(HAIKU, { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(
      inputPerMTokPence + outputPerMTokPence,
    );
  });

  it("scales linearly with token counts", () => {
    const { inputPerMTokPence, outputPerMTokPence } = AI_MODEL_PRICING[HAIKU];
    const expected =
      Math.round(((500_000 / 1_000_000) * inputPerMTokPence + (200_000 / 1_000_000) * outputPerMTokPence) * 10_000) /
      10_000;
    expect(costPence(HAIKU, { input_tokens: 500_000, output_tokens: 200_000 })).toBe(expected);
  });

  it("returns 0 for zero / missing usage", () => {
    expect(costPence(HAIKU, { input_tokens: 0, output_tokens: 0 })).toBe(0);
    expect(costPence(HAIKU, null)).toBe(0);
    expect(costPence(HAIKU, undefined)).toBe(0);
    expect(costPence(HAIKU, {})).toBe(0);
  });

  it("counts cache tokens at the write (1.25×) and read (0.1×) input multipliers", () => {
    const { inputPerMTokPence } = AI_MODEL_PRICING[HAIKU];
    const expected =
      Math.round(((1_000_000 * 1.25 + 1_000_000 * 0.1) / 1_000_000) * inputPerMTokPence * 10_000) / 10_000;
    expect(
      costPence(HAIKU, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBe(expected);
  });

  it("falls back to a non-zero default rate for an unknown model", () => {
    const known = costPence(HAIKU, { input_tokens: 1000, output_tokens: 1000 });
    const unknown = costPence("some-future-model", { input_tokens: 1000, output_tokens: 1000 });
    expect(unknown).toBeGreaterThan(0);
    expect(unknown).toBe(known); // default mirrors the Haiku rate today
  });
});
