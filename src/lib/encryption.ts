import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM application-layer encryption for sensitive at-rest values
// (Xero refresh tokens to start). Format on disk:
//   enc:v1:<iv-b64>:<auth-tag-b64>:<ciphertext-b64>
//
// Plaintext rows from before this layer was introduced are detected by the
// missing prefix and passed through, so the migration is gradual: anything
// touched (token refresh, OAuth reconnect) gets re-stored encrypted.

const PREFIX = "enc:v1:";

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY env var missing (need 32 bytes base64).");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `APP_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}. Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith(PREFIX)) {
    // Legacy plaintext value — pass through. Caller can re-encrypt on
    // next write to gradually migrate.
    return ciphertext;
  }
  const body = ciphertext.slice(PREFIX.length);
  const [ivB64, authTagB64, dataB64] = body.split(":");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Encrypted blob is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
