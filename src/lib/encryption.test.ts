import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// encryption.ts reads APP_ENCRYPTION_KEY at call time via key(). Set it
// before each test so the module-level call doesn't blow up at import.
const VALID_KEY = crypto.randomBytes(32).toString("base64");

describe("encryption", () => {
  const origKey = process.env.APP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env.APP_ENCRYPTION_KEY = origKey;
  });

  it("encrypt + decrypt round-trips plaintext", async () => {
    const { encrypt, decrypt } = await import("./encryption");
    const plain = "hello world";
    const cipher = encrypt(plain);
    expect(cipher).toMatch(/^enc:v1:/);
    expect(cipher).not.toContain("hello world");
    expect(decrypt(cipher)).toBe(plain);
  });

  it("isEncrypted detects the prefix", async () => {
    const { isEncrypted } = await import("./encryption");
    expect(isEncrypted("enc:v1:iv:tag:data")).toBe(true);
    expect(isEncrypted("plain")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
  });

  it("decrypt passes through legacy plaintext (no prefix)", async () => {
    const { decrypt } = await import("./encryption");
    expect(decrypt("legacy-plain-value")).toBe("legacy-plain-value");
  });

  it("throws on malformed encrypted blob", async () => {
    const { decrypt } = await import("./encryption");
    expect(() => decrypt("enc:v1:onlyone")).toThrow(/malformed/i);
  });

  it("throws when APP_ENCRYPTION_KEY missing", async () => {
    delete process.env.APP_ENCRYPTION_KEY;
    const { encrypt } = await import("./encryption");
    expect(() => encrypt("x")).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("throws when key is wrong length", async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.from("tooshort").toString("base64");
    const { encrypt } = await import("./encryption");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
  });

  it("decrypt fails on tampered ciphertext (auth tag mismatch)", async () => {
    const { encrypt, decrypt } = await import("./encryption");
    const cipher = encrypt("secret");
    // Flip one char in the ciphertext segment.
    const parts = cipher.split(":");
    parts[parts.length - 1] = parts[parts.length - 1].replace(/^./, "A");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});
