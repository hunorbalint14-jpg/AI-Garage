import Link from "next/link";

export const ACCOUNT_TABS = [
  { key: "profile", label: "Profile" },
  { key: "security", label: "Security" },
  { key: "notifications", label: "Notifications" },
] as const;

export type AccountTabKey = (typeof ACCOUNT_TABS)[number]["key"];

export function isAccountTab(v: string | undefined): v is AccountTabKey {
  return !!v && ACCOUNT_TABS.some((t) => t.key === v);
}

export function AccountTabs({ active }: { active: AccountTabKey }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ACCOUNT_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/staff/account?tab=${t.key}`}
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
