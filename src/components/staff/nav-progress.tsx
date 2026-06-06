"use client";

import Link, { useLinkStatus } from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AigSpinner } from "@/components/ui/aig-spinner";

// In-app navigation progress. Unlike a route `loading.tsx` (which unmounts the
// current page and shows a fallback), this keeps the current page mounted and
// lays a translucent dim + brand spinner *over* it while the next route loads —
// so the app stays visible behind the overlay.
//
// Each TrackedLink reports its own `useLinkStatus().pending` into a shared
// counter; the overlay shows while the counter is > 0. Requires that the
// destination has NO `loading.tsx` (a route fallback would make the transition
// "instant" and skip the pending phase).

const NavProgressContext = createContext<{ bump: (n: number) => void; active: boolean }>({
  bump: () => {},
  active: false,
});

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);
  const bump = useCallback((n: number) => setCount((c) => Math.max(0, c + n)), []);
  return (
    <NavProgressContext.Provider value={{ bump, active: count > 0 }}>
      {children}
    </NavProgressContext.Provider>
  );
}

// Descendant of a <Link>: flips the shared counter while that link is pending.
function NavSignal() {
  const { pending } = useLinkStatus();
  const { bump } = useContext(NavProgressContext);
  useEffect(() => {
    if (!pending) return;
    bump(1);
    return () => bump(-1);
  }, [pending, bump]);
  return null;
}

// Drop-in replacement for next/link that participates in the nav overlay.
export function TrackedLink({ children, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <NavSignal />
    </Link>
  );
}

// Translucent dim + centred brand spinner. Rendered once, near the shell root.
export function NavProgressOverlay() {
  const { active } = useContext(NavProgressContext);
  if (!active) return null;
  return (
    <div
      role="status"
      aria-label="Loading"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#090b0f]/45 backdrop-blur-[3px]"
    >
      <span className="text-[#22c55e]" style={{ fontSize: 44 }}>
        <AigSpinner label="Loading" />
      </span>
    </div>
  );
}
