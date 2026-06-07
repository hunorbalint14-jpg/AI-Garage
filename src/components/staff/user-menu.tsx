"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { User, ShieldCheck, Bell } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SignOutButton } from "@/app/staff/sign-out-button";

const MENU_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/staff/account?tab=profile", label: "Profile", icon: User },
  { href: "/staff/account?tab=security", label: "Security", icon: ShieldCheck },
  { href: "/staff/account?tab=notifications", label: "Notifications", icon: Bell },
];

// The circular user avatar in the bottom-left rail. Clicking it opens a popover
// with a link to the account page + sign out.
export function UserMenu({
  initials,
  name,
  email,
  brandColor,
}: {
  initials: string;
  name: string;
  email: string | null;
  brandColor: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute bottom-0 left-full z-50 ml-2 w-56 rounded-lg border border-[#2a2f37] bg-[#15181d] p-1 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-semibold text-[#e6e8eb]" title={name}>
              {name}
            </p>
            {email && (
              <p className="truncate font-mono text-[10px] text-[#5a6170]" title={email}>
                {email}
              </p>
            )}
          </div>
          <div className="my-1 h-px bg-[#2a2f37]" />
          {MENU_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded px-3 py-2 text-sm text-[#9aa1ad] transition-colors hover:bg-white/[0.04] hover:text-[#e6e8eb]"
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
          <div className="my-1 h-px bg-[#2a2f37]" />
          <div className="px-1 pb-1 pt-0.5">
            <SignOutButton dark />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Account"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ background: `${brandColor}22`, color: brandColor }}
        className="mb-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold font-mono transition-shadow hover:ring-2 hover:ring-white/10"
      >
        {initials}
      </button>
    </div>
  );
}
