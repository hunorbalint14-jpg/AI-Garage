// Validates a user-supplied `next` redirect target. A leading-slash check alone
// is not enough: `//evil.com` and `/\evil.com` start with `/` yet browsers
// resolve them as protocol-relative redirects to another origin. Only accept a
// single-leading-slash path that points within this app; otherwise fall back.
export function safeInternalPath(
  next: string | null | undefined,
  fallback = "/staff",
): string {
  if (!next) return fallback;
  if (next[0] !== "/") return fallback; // reject absolute/scheme-relative URLs
  if (next[1] === "/" || next[1] === "\\") return fallback; // reject `//` and `/\`
  return next;
}
