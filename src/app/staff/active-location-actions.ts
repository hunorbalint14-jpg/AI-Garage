"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getStaffContext, ACTIVE_LOCATION_COOKIE } from "@/lib/staff-context";

// Switch the active branch. SECURITY: the cookie is never trusted on its own —
// getStaffContext re-derives the caller's accessible locations from their
// membership, and we refuse any branch they can't act in. This is the real
// operational-isolation boundary (staff queries run on the RLS-bypassing admin
// client), so the membership re-check here must stay.
export async function setActiveLocation(locationId: string): Promise<{ error?: string }> {
  const ctx = await getStaffContext();
  if (!ctx) return { error: "Not signed in." };
  if (!ctx.accessibleLocations.some((l) => l.id === locationId)) {
    return { error: "You don't have access to that branch." };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_LOCATION_COOKIE, locationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/staff", "layout");
  return {};
}
