import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";

// Shared zod field schemas + a tiny helper so server actions validate untrusted
// FormData input consistently before it reaches the DB or external APIs. Server
// actions keep their `{ error: string }` return shape; `parseOrError` collapses
// a zod failure into the first human-readable message.

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .pipe(z.email("Email looks invalid."));

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name is too long.");

// Optional free-text phone. Empty string normalises to undefined.
export const phoneSchema = z
  .string()
  .trim()
  .max(32, "Phone number is too long.")
  .optional()
  .transform((v) => (v ? v : undefined));

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);

export type ParseResult<T> = { data: T } | { error: string };

// Validate `input` against `schema`, returning the parsed data or the first
// validation message. Coerces unknown FormData values safely.
export function parseOrError<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data };
  const first = result.error.issues[0]?.message ?? "Invalid input.";
  return { error: first };
}
