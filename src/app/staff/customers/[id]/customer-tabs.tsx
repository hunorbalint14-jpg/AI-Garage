"use client";

import { useState, type ReactNode } from "react";

export type CustomerTab = { key: string; label: string; content: ReactNode };

// Horizontal tab bar for the customer detail page. Server-rendered section JSX
// (including the existing client panels) is passed in as `content`; inactive
// tabs stay mounted but hidden so panel state survives a tab switch.
export function CustomerTabs({ tabs }: { tabs: CustomerTab[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? "");

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-1 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tabs.map((t) => (
        <div key={t.key} hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
