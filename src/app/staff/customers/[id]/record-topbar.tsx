"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ChevronLeft } from "lucide-react";
import { DeleteCustomerButton } from "./delete-buttons";

// Back / Edit / Delete rail above the record. `Esc` returns to the list — via
// router.back() when the record was opened from it, so the list comes back with
// its search, segment and page intact rather than reset.
export function RecordTopBar({ customerId }: { customerId: string }) {
  const router = useRouter();

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push("/staff/customers");
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (window.history.length > 1) router.back();
      else router.push("/staff/customers");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={back}
        className="inline-flex items-center gap-1.5 text-[13px] text-ws-text-2 transition-colors hover:text-ws-text"
      >
        <ChevronLeft className="h-[15px] w-[15px]" />
        Customers
        <span className="ml-1 rounded-[4px] border border-ws-border px-1.5 py-px font-mono text-[10px] text-ws-text-3">
          ESC
        </span>
      </button>
      <div className="flex items-center gap-2">
        <Link
          href={`/staff/customers/${customerId}/edit`}
          className="inline-flex h-[30px] items-center rounded-[8px] border border-ws-border bg-ws-card px-3 text-[13px] font-medium text-ws-text transition-colors hover:bg-ws-hover"
        >
          Edit
        </Link>
        <DeleteCustomerButton customerId={customerId} />
      </div>
    </div>
  );
}
