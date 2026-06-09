// Platform components shown on the public /status page and offered when
// declaring an incident. Keep the two in sync by sourcing both from here. A
// component reads as degraded/down when a published, unresolved incident lists
// it (until per-service synthetic checks land in a later PR).
export const PLATFORM_COMPONENTS = [
  "Booking & customer portal",
  "Staff dashboard",
  "Payments",
  "Email",
  "SMS & WhatsApp",
  "MOT & recall lookups",
] as const;

export type PlatformComponent = (typeof PLATFORM_COMPONENTS)[number];
