"use server";

import { lookupVehicle } from "@/lib/dvla";
import { enforceRateLimit } from "@/lib/rate-limit";

export type RegLookupResult =
  | {
      found: true;
      registration: string;
      make: string | null;
      model: string | null;
      year: number | null;
      colour: string | null;
      motExpiry: string | null; // YYYY-MM-DD
    }
  | { found: false; error?: string };

// Public (unauthenticated) DVSA lookup behind the booking widget's
// "Find my car" button. Rate-limited per IP — this protects the DVSA quota,
// and the data returned is the public MOT-check dataset, nothing tenant-owned.
export async function lookupRegistration(rawReg: string): Promise<RegLookupResult> {
  const reg = rawReg.replace(/\s+/g, "").toUpperCase();
  // UK plates are 2–7 alphanumerics once spaces are stripped.
  if (!/^[A-Z0-9]{2,7}$/.test(reg)) {
    return { found: false, error: "That doesn't look like a UK registration." };
  }

  const limit = await enforceRateLimit("lookup");
  if (!limit.ok) {
    return { found: false, error: "Too many lookups — please try again shortly." };
  }

  const result = await lookupVehicle(reg);
  if (!result.success) {
    // Don't leak config/API details to the public widget.
    const notFound = result.error === "Vehicle not found.";
    return {
      found: false,
      error: notFound ? "We couldn't find that registration." : undefined,
    };
  }

  const v = result.vehicle;
  return {
    found: true,
    registration: v.registration,
    make: v.make,
    model: v.model,
    year: v.year,
    colour: v.colour,
    motExpiry: v.motExpiry,
  };
}
