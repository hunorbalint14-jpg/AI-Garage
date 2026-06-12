import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { signApply, signStatus, verifyRedirect } from "./bumper";

const SECRET = "test_secret_123";

function hmac(base: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(base, "utf8").digest("hex");
}

describe("signApply", () => {
  it("upper-cases keys, sorts alphabetically, trails every pair with &", () => {
    const sig = signApply({ b_key: "two", a_key: "one" }, SECRET);
    expect(sig).toBe(hmac("A_KEY=one&B_KEY=two&"));
  });

  it("excludes api_key, signature, product_description, preferred_product_type, additional_data", () => {
    const sig = signApply(
      {
        amount: "300.00",
        api_key: "k",
        signature: "s",
        product_description: [{ item: "MOT", quantity: "1", price: "54.85" }],
        preferred_product_type: "paylater",
        additional_data: "x",
      },
      SECRET,
    );
    expect(sig).toBe(hmac("AMOUNT=300.00&"));
  });

  it("serializes booleans Python-style", () => {
    const sig = signApply({ send_sms: false, send_email: true }, SECRET);
    expect(sig).toBe(hmac("SEND_EMAIL=True&SEND_SMS=False&"));
  });

  it("skips null and undefined values", () => {
    const sig = signApply({ amount: "10.00", county: undefined, street: null }, SECRET);
    expect(sig).toBe(hmac("AMOUNT=10.00&"));
  });

  it("uses the secret byte-for-byte (no trimming)", () => {
    const quirkySecret = '"starts-with-a-quote';
    expect(signApply({ amount: "1.00" }, quirkySecret)).toBe(
      hmac("AMOUNT=1.00&", quirkySecret),
    );
  });
});

describe("signStatus", () => {
  it("signs TOKEN=value& only", () => {
    expect(signStatus("abc123", SECRET)).toBe(hmac("TOKEN=abc123&"));
  });
});

describe("verifyRedirect", () => {
  it("accepts a correctly signed return", () => {
    const signature = hmac("SUCCESS=true&TOKEN=tok1&");
    expect(verifyRedirect({ success: "true", token: "tok1", signature }, SECRET)).toBe(true);
  });

  it("rejects a tampered token", () => {
    const signature = hmac("SUCCESS=true&TOKEN=tok1&");
    expect(verifyRedirect({ success: "true", token: "tok2", signature }, SECRET)).toBe(false);
  });

  it("rejects a flipped success flag", () => {
    const signature = hmac("SUCCESS=false&TOKEN=tok1&");
    expect(verifyRedirect({ success: "true", token: "tok1", signature }, SECRET)).toBe(false);
  });

  it("rejects garbage signatures without throwing", () => {
    expect(verifyRedirect({ success: "true", token: "tok1", signature: "" }, SECRET)).toBe(false);
    expect(
      verifyRedirect({ success: "true", token: "tok1", signature: "zz-not-hex" }, SECRET),
    ).toBe(false);
  });
});
