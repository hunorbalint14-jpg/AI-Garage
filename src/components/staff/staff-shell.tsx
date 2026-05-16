"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, ChevronLeft, ChevronRight, ChevronDown, X, Menu } from "lucide-react";
import { LocationSwitcher } from "@/components/staff/location-switcher";
import { SignOutButton } from "@/app/staff/sign-out-button";
import {
  filterModulesForRole,
  findActive,
  onBrandColor,
  type NavModule,
} from "@/components/staff/staff-modules";

type Location = { id: string; slug: string; name: string };

export function StaffShell({
  brandColor,
  orgRole,
  orgName,
  orgInitials,
  orgLogoUrl,
  userName,
  userEmail,
  userInitials,
  locations,
  currentSlug,
  role,
  children,
}: {
  brandColor: string;
  orgRole?: "owner" | "admin" | null;
  orgName: string;
  orgInitials: string;
  orgLogoUrl: string | null;
  userName: string;
  userEmail: string | null;
  userInitials: string;
  locations: Location[];
  currentSlug: string;
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || "/staff";
  const modules = useMemo(() => filterModulesForRole(orgRole), [orgRole]);
  const { module: activeModule, item: activeItem } = findActive(pathname, modules);
  const onBrand = useMemo(() => onBrandColor(brandColor), [brandColor]);

  // Tablet/mobile UI state. Drawer = tablet portrait pane; sheet = mobile picker.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Auto-close overlays on navigation so the user lands on the new page
  // without anything in the way.
  useEffect(() => {
    setDrawerOpen(false);
    setSheetOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0e1014] text-[#e6e8eb] dark">
      {/* ─────────────────────────── RAIL ─────────────────────────── */}
      <aside className="hidden sm:flex w-[64px] shrink-0 flex-col items-center border-r border-[#2a2f37] bg-[#0a0c0f] py-3 z-20">
        <OrgChip initials={orgInitials} brandColor={brandColor} onBrand={onBrand} logoUrl={orgLogoUrl} />
        <div className="my-3 h-px w-6 bg-[#2a2f37]" />

        <nav className="flex flex-1 flex-col items-center gap-1 w-full">
          {modules.map((m) => {
            const isActive = m.key === activeModule.key;
            const Icon = m.icon;
            // First item in module is the "module home" we navigate to when
            // clicked from the rail. Pane shows full sub-list.
            const moduleHome = m.items[0].href;
            return (
              <Link
                key={m.key}
                href={moduleHome}
                className="group relative grid h-11 w-11 place-items-center rounded-lg transition-colors"
                style={
                  isActive
                    ? { background: brandColor, color: onBrand }
                    : undefined
                }
                title={m.label}
                onClick={() => {
                  // On tablet, opening a module also reveals its pane
                  if (window.matchMedia("(max-width: 1023px)").matches) {
                    setDrawerOpen(true);
                  }
                }}
              >
                <ModuleIconButton isActive={isActive} Icon={m.icon} />
                {/* Hover tooltip (desktop only) */}
                <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 hidden group-hover:lg:block whitespace-nowrap rounded border border-[#2a2f37] bg-[#0a0c0f] px-2.5 py-1 text-xs text-[#e6e8eb] shadow-lg z-50">
                  {m.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <UserChip initials={userInitials} brandColor={brandColor} />
      </aside>

      {/* ──────────────────────── CONTEXT PANE ─────────────────────── */}
      {/* lg+: pinned, in flow. md and below: drawer overlay (controlled by drawerOpen). */}
      <PaneWrapper drawerOpen={drawerOpen}>
        <ContextPane
          module={activeModule}
          activeItemKey={activeItem.key}
          brandColor={brandColor}
          orgName={orgName}
          role={role}
          locations={locations}
          currentSlug={currentSlug}
          userName={userName}
          userEmail={userEmail}
          onCloseDrawer={() => setDrawerOpen(false)}
        />
      </PaneWrapper>

      {/* Scrim behind drawer on tablet */}
      {drawerOpen && (
        <button
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="lg:hidden fixed inset-0 z-10 bg-black/40 cursor-default"
        />
      )}

      {/* ──────────────────────── MAIN COLUMN ──────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header (sm and below) */}
        <header className="sm:hidden flex items-center gap-2 border-b border-[#2a2f37] bg-[#15181d] px-3 py-2.5">
          <OrgChip initials={orgInitials} brandColor={brandColor} onBrand={onBrand} logoUrl={orgLogoUrl} size={28} />
          <button
            onClick={() => setSheetOpen(true)}
            className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
          >
            <div className="min-w-0">
              <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#5a6170]">
                {orgName}
              </div>
              <div className="flex items-center gap-1 truncate text-[15px] font-bold leading-tight">
                <span>{activeModule.label}</span>
                <span className="text-[#5a6170]">·</span>
                <span className="font-medium text-[#9aa1ad]">{activeItem.label}</span>
                <ChevronDown className="h-3 w-3 text-[#5a6170]" />
              </div>
            </div>
          </button>
          <button className="grid h-9 w-9 place-items-center rounded-lg bg-[#1c2026]" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
        </header>

        {/* Mobile sub-page strip */}
        <nav className="sm:hidden flex gap-1.5 overflow-x-auto border-b border-[#2a2f37] px-3 py-2 bg-[#0e1014]">
          {activeModule.items.map((s) => {
            const isActive = s.key === activeItem.key;
            const Icon = s.icon;
            return (
              <Link
                key={s.key}
                href={s.href}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap"
                style={
                  isActive
                    ? { background: brandColor, color: onBrand, fontWeight: 700 }
                    : { background: "#1c2026", color: "#9aa1ad" }
                }
              >
                <Icon className="h-3 w-3" />
                {s.label}
              </Link>
            );
          })}
        </nav>

        {/* Page body */}
        <main className="flex-1 overflow-auto p-6 pb-24 sm:pb-6 lg:p-8">
          {children}
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="sm:hidden fixed inset-x-0 bottom-0 z-30 flex border-t border-[#2a2f37] bg-[#15181d]/95 backdrop-blur px-1 pb-3 pt-1.5">
          {modules.map((m) => {
            const isActive = m.key === activeModule.key;
            const Icon = m.icon;
            return (
              <Link
                key={m.key}
                href={m.items[0].href}
                className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1"
                style={{ color: isActive ? brandColor : "#9aa1ad" }}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px]" style={{ fontWeight: isActive ? 700 : 500 }}>
                  {m.label}
                </span>
                {isActive && (
                  <span
                    className="absolute bottom-0 h-[2.5px] w-4 rounded"
                    style={{ background: brandColor }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Mobile module sheet */}
      {sheetOpen && (
        <ModuleSheet
          modules={modules}
          activeModuleKey={activeModule.key}
          activeItemKey={activeItem.key}
          brandColor={brandColor}
          onBrand={onBrand}
          orgName={orgName}
          role={role}
          userName={userName}
          userEmail={userEmail}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── sub-components ─────────────────────────── */

function ModuleIconButton({ Icon }: { isActive: boolean; Icon: any }) {
  return <Icon className="h-[19px] w-[19px]" />;
}

function PaneWrapper({
  drawerOpen,
  children,
}: {
  drawerOpen: boolean;
  children: React.ReactNode;
}) {
  // lg and up: in-flow flex item, always visible.
  // md and below: fixed-position overlay drawer; visible only when drawerOpen.
  return (
    <>
      {/* Pinned pane (desktop only) */}
      <aside className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-[#2a2f37] bg-[#15181d]">
        {children}
      </aside>
      {/* Drawer pane (sm-md only) */}
      <aside
        className={
          "lg:hidden fixed top-0 bottom-0 left-[64px] z-20 w-[240px] flex-col border-r border-[#2a2f37] bg-[#15181d] shadow-2xl transition-transform " +
          (drawerOpen ? "translate-x-0 flex" : "-translate-x-full hidden")
        }
      >
        {children}
      </aside>
    </>
  );
}

function ContextPane({
  module,
  activeItemKey,
  brandColor,
  orgName,
  role,
  locations,
  currentSlug,
  userName,
  userEmail,
  onCloseDrawer,
}: {
  module: NavModule;
  activeItemKey: string;
  brandColor: string;
  orgName: string;
  role: string;
  locations: Location[];
  currentSlug: string;
  userName: string;
  userEmail: string | null;
  onCloseDrawer: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b border-[#2a2f37] px-4 pb-3 pt-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.2em] text-[#5a6170]">// MODULE</div>
          <div className="mt-1 text-[15px] font-bold text-[#e6e8eb]">{module.label}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6170] mt-1 truncate">
            {orgName} · {role.toUpperCase()}
          </div>
        </div>
        <button
          onClick={onCloseDrawer}
          className="lg:hidden grid h-7 w-7 place-items-center rounded text-[#5a6170] hover:bg-[#1c2026]"
          aria-label="Close menu"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-[#2a2f37] px-3 py-3">
        <LocationSwitcher
          locations={locations}
          currentSlug={currentSlug}
          dark={true}
        />
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {module.items.map((s) => {
          const isActive = s.key === activeItemKey;
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              href={s.href}
              className={
                "flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] transition-colors " +
                (isActive
                  ? "bg-[#1c2026] text-[#e6e8eb] font-semibold"
                  : "text-[#9aa1ad] hover:bg-white/[0.04] hover:text-[#e6e8eb] font-medium")
              }
              style={{
                borderLeft: `2px solid ${isActive ? brandColor : "transparent"}`,
                paddingLeft: 10,
              }}
            >
              <Icon className="h-[15px] w-[15px] shrink-0" />
              {s.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#2a2f37] px-3 py-3">
        <div className="mb-2.5 min-w-0">
          <p className="truncate text-[13px] font-semibold text-[#e6e8eb]" title={userName}>
            {userName}
          </p>
          <p
            className="truncate font-mono text-[10px] text-[#5a6170]"
            title={userEmail ?? ""}
          >
            {userEmail}
          </p>
        </div>
        <SignOutButton dark={true} />
      </div>
    </>
  );
}

function OrgChip({
  initials,
  brandColor,
  onBrand,
  logoUrl,
  size = 30,
}: {
  initials: string;
  brandColor: string;
  onBrand: string;
  logoUrl?: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <div
        style={{ width: size, height: size, background: "#fff" }}
        className="grid shrink-0 place-items-center overflow-hidden rounded"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt={initials}
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      </div>
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        background: brandColor,
        color: onBrand,
        clipPath: "polygon(0 0, 100% 0, 100% 78%, 78% 100%, 0 100%)",
        fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      }}
      className="grid shrink-0 place-items-center text-[13px] font-extrabold"
    >
      {initials}
    </div>
  );
}

function UserChip({ initials, brandColor }: { initials: string; brandColor: string }) {
  return (
    <div
      style={{
        background: `${brandColor}22`,
        color: brandColor,
        fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      }}
      className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold"
    >
      {initials}
    </div>
  );
}

function ModuleSheet({
  modules,
  activeModuleKey,
  activeItemKey,
  brandColor,
  onBrand,
  orgName,
  role,
  userName,
  userEmail,
  onClose,
}: {
  modules: NavModule[];
  activeModuleKey: string;
  activeItemKey: string;
  brandColor: string;
  onBrand: string;
  orgName: string;
  role: string;
  userName: string;
  userEmail: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 sm:hidden">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 cursor-default"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[82%] overflow-y-auto rounded-t-2xl border-t border-[#2a2f37] bg-[#15181d] px-4 pt-2 pb-24">
        <div className="mx-auto my-1.5 h-1 w-9 rounded bg-[#3a4049]" />
        <div className="mb-2 mt-2 flex items-baseline justify-between">
          <div className="text-[16px] font-bold text-[#e6e8eb]">Jump to…</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6170]">
            {orgName} · {role.toUpperCase()}
          </div>
        </div>
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.key} className="mt-3">
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <Icon
                  className="h-[14px] w-[14px]"
                  style={{ color: m.key === activeModuleKey ? brandColor : "#9aa1ad" }}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#5a6170]">
                  {m.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {m.items.map((s) => {
                  const SIcon = s.icon;
                  const isActive = m.key === activeModuleKey && s.key === activeItemKey;
                  return (
                    <Link
                      key={s.key}
                      href={s.href}
                      onClick={onClose}
                      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px]"
                      style={
                        isActive
                          ? { background: brandColor, color: onBrand, fontWeight: 700 }
                          : { background: "#1c2026", color: "#e6e8eb", fontWeight: 500 }
                      }
                    >
                      <SIcon className="h-[14px] w-[14px]" />
                      <span className="flex-1">{s.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="mt-5 border-t border-[#2a2f37] pt-4">
          <div className="mb-3">
            <p className="truncate text-[13px] font-semibold text-[#e6e8eb]">{userName}</p>
            {userEmail && (
              <p className="truncate font-mono text-[10px] text-[#5a6170]">{userEmail}</p>
            )}
          </div>
          <SignOutButton dark={true} />
        </div>
      </div>
    </div>
  );
}
