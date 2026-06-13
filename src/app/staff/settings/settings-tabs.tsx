import Link from "next/link";

// Tab definitions for the Settings page. `key` drives the ?tab= param and the
// section grouping in page.tsx.
export const SETTINGS_TABS = [
  { key: "business", label: "Business" },
  { key: "booking", label: "Booking" },
  { key: "payments", label: "Payments & Quotes" },
  { key: "integrations", label: "Integrations" },
  { key: "compliance", label: "Compliance" },
  { key: "locations", label: "Locations" },
  { key: "security", label: "Security & Legal" },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]["key"];

export function isSettingsTab(v: string | undefined): v is SettingsTabKey {
  return !!v && SETTINGS_TABS.some((t) => t.key === v);
}

// Horizontal tab bar. Server component — active state comes from the page's
// ?tab= param, each tab is a plain link (deep-linkable, no client JS).
export function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {SETTINGS_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/staff/settings?tab=${t.key}`}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
