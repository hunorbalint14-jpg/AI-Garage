export type Permissions = {
  bookings: boolean;
  customers: boolean;
  reminders: boolean;
  revenue: boolean;
  campaigns: boolean;
  services: boolean;
  bays: boolean;
  staff: boolean;
  automations: boolean;
};

export const DEFAULT_PERMISSIONS: Record<string, Permissions> = {
  manager: {
    bookings: true,
    customers: true,
    reminders: true,
    revenue: true,
    campaigns: true,
    services: true,
    bays: true,
    staff: false,
    automations: true,
  },
  staff: {
    bookings: true,
    customers: true,
    reminders: true,
    revenue: false,
    campaigns: false,
    services: false,
    bays: false,
    staff: false,
    automations: false,
  },
};

export const DEFAULT_PERMS: Permissions = DEFAULT_PERMISSIONS.staff;
