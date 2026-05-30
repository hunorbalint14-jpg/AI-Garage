import { timingSafeEqual } from "node:crypto";

// Constant-time string comparison for secrets/signatures. A plain `===` short-
// circuits on the first differing byte, leaking length and content via timing.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
