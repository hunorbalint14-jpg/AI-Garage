// UK registration plates: uppercase, no spaces, alphanumeric.
// We don't validate the actual plate format (too many regional variants).
const PLATE_RE = /^[A-Z0-9]{1,8}$/;

export function normalizeRegistration(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function validateRegistration(input: string): string | null {
  const reg = normalizeRegistration(input);
  if (!reg) return "Registration is required.";
  if (!PLATE_RE.test(reg)) {
    return "Registration must be 1–8 letters and numbers (no spaces or symbols).";
  }
  return null;
}
