"use server";

import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";

// Server-side search behind the customer/vehicle typeahead picker. The
// new-booking and new-quote pages previously shipped every customer (up to
// 1000) and vehicle (up to 2000) at the location to the client and filtered
// there; this returns just the handful of matches per debounced keystroke,
// served by the pg_trgm indexes.

export type PickerVehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
};

export type PickerCustomer = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  // The customer's home branch — used to warn staff when booking them into a
  // different branch than the one they registered at.
  preferredLocationId: string | null;
  vehicles: PickerVehicle[];
};

const PICKER_LIMIT = 10;
const PICKER_SELECT =
  "id, full_name, email, phone, preferred_location_id, vehicles(id, registration, make, model, year)";

type RawCustomer = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_location_id: string | null;
  vehicles: PickerVehicle[] | null;
};

function toPickerCustomers(data: unknown): PickerCustomer[] {
  return ((data ?? []) as RawCustomer[]).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    phone: c.phone,
    preferredLocationId: c.preferred_location_id,
    vehicles: c.vehicles ?? [],
  }));
}

// Fetch one customer (with vehicles) for ?customer= deep links. Customers are
// org-global, so scoped to the caller's organisation.
export async function getPickerCustomer(customerId: string): Promise<PickerCustomer | null> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  const { data } = await admin
    .from("customers")
    .select(PICKER_SELECT)
    .eq("organization_id", ctx.organization.id)
    .eq("id", customerId)
    .maybeSingle();
  return data ? toPickerCustomers([data])[0] : null;
}

export async function searchCustomersForPicker(query: string): Promise<PickerCustomer[]> {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();
  // PostgREST .or() filter syntax breaks on commas/parens in the value.
  const q = query.trim().slice(0, 80).replace(/[,()]/g, " ").trim();

  if (!q) {
    // Empty query (input focused): first few customers by name, so small
    // garages see a list without typing.
    const { data } = await admin
      .from("customers")
      .select(PICKER_SELECT)
      .eq("organization_id", ctx.organization.id)
      .order("full_name", { ascending: true })
      .limit(PICKER_LIMIT);
    return toPickerCustomers(data);
  }

  const [custRes, vehRes] = await Promise.all([
    admin
      .from("customers")
      .select(PICKER_SELECT)
      .eq("organization_id", ctx.organization.id)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`)
      .order("full_name", { ascending: true })
      .limit(PICKER_LIMIT),
    admin
      .from("vehicles")
      .select("customer_id")
      .eq("organization_id", ctx.organization.id)
      .ilike("registration", `%${q}%`)
      .limit(PICKER_LIMIT),
  ]);

  const byDetails = toPickerCustomers(custRes.data);
  const regCustomerIds = [
    ...new Set(((vehRes.data ?? []) as { customer_id: string }[]).map((v) => v.customer_id)),
  ];
  const missingIds = regCustomerIds.filter((id) => !byDetails.some((c) => c.id === id));

  let byReg: PickerCustomer[] = [];
  if (missingIds.length > 0) {
    const { data } = await admin
      .from("customers")
      .select(PICKER_SELECT)
      .eq("organization_id", ctx.organization.id)
      .in("id", missingIds);
    byReg = toPickerCustomers(data);
  }

  // Reg matches first — typing a plate is the most specific intent.
  return [...byReg, ...byDetails].slice(0, PICKER_LIMIT);
}
