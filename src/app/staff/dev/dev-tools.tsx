"use client";

import { useState, useTransition } from "react";
import { generateStaffTestLink, generateCustomerTestLink } from "./actions";
import type { DevCustomer, DevStaff } from "./page";

function copyText(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;opacity:0;top:0;left:0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

function LinkPanel({
  link,
  label,
  onClose,
}: {
  link: string;
  label: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    copyText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          Test link for {label} — expires in 1 hour
        </p>
        <button onClick={onClose} className="text-xs text-amber-600 dark:text-amber-400 underline shrink-0">
          Dismiss
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-amber-100 dark:bg-amber-900/40 px-2 py-1.5 text-xs break-all font-mono text-amber-900 dark:text-amber-200 select-all">
          {link}
        </code>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => window.open(link, "_blank")}
          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
        >
          Open in new tab
        </button>
        <button
          onClick={handleCopy}
          className="rounded border border-amber-300 dark:border-amber-700 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      <p className="text-[10px] text-amber-600 dark:text-amber-500">
        Open in an incognito window to test without logging out of your own session.
      </p>
    </div>
  );
}

function StaffRow({ member }: { member: DevStaff }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleTest() {
    setError(null);
    setLink(null);
    start(async () => {
      const result = await generateStaffTestLink(member.email);
      if ("error" in result) setError(result.error);
      else setLink(result.link);
    });
  }

  const displayName = member.fullName ?? member.email;
  const roleStyle: Record<string, string> = {
    owner: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    admin: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
    manager: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
    staff: "bg-muted text-muted-foreground",
  };

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium capitalize ${roleStyle[member.role] ?? roleStyle.staff}`}>
          {member.role}
        </span>
        <button
          onClick={handleTest}
          disabled={pending}
          className="shrink-0 rounded border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
        >
          {pending ? "Generating…" : "Log in as"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {link && <LinkPanel link={link} label={displayName} onClose={() => setLink(null)} />}
    </div>
  );
}

function CustomerRow({ customer }: { customer: DevCustomer }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleTest() {
    setError(null);
    setLink(null);
    start(async () => {
      const result = await generateCustomerTestLink(customer.id);
      if ("error" in result) setError(result.error);
      else setLink(result.link);
    });
  }

  const displayName = customer.fullName ?? customer.email ?? "Unknown";

  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          <p className="text-xs text-muted-foreground truncate">{customer.email ?? "No email"}</p>
        </div>
        {!customer.hasAuth && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground">
            No portal account
          </span>
        )}
        {!customer.email ? (
          <span className="text-xs text-muted-foreground">No email — cannot test</span>
        ) : (
          <button
            onClick={handleTest}
            disabled={pending}
            className="shrink-0 rounded border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
          >
            {pending ? "Generating…" : customer.hasAuth ? "Log in as" : "Set up & log in"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {link && <LinkPanel link={link} label={displayName} onClose={() => setLink(null)} />}
    </div>
  );
}

export function DevTools({
  customers,
  staff,
}: {
  customers: DevCustomer[];
  staff: DevStaff[];
}) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");

  const filteredCustomers = customers.filter((c) => {
    const q = customerSearch.toLowerCase();
    return (c.fullName?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)) ?? true;
  });

  const filteredStaff = staff.filter((s) => {
    const q = staffSearch.toLowerCase();
    return s.email.toLowerCase().includes(q) || (s.fullName?.toLowerCase().includes(q) ?? false);
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Warning banner */}
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3">
        <p className="text-sm font-semibold text-red-800 dark:text-red-300">Owner-only test feature</p>
        <p className="text-xs text-red-700 dark:text-red-400 mt-1">
          Generates one-time login links that expire in 1 hour. Open in an incognito window to test without losing your own session. Never share these links.
        </p>
      </div>

      {/* Staff section */}
      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Staff portal</h2>
          <input
            type="search"
            placeholder="Search staff…"
            value={staffSearch}
            onChange={(e) => setStaffSearch(e.target.value)}
            className="rounded-md border border-black/20 dark:border-white/25 bg-transparent px-2 py-1 text-xs w-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <p className="text-xs text-muted-foreground">Log in to the staff portal as any team member.</p>
        {filteredStaff.length === 0 ? (
          <p className="text-xs text-muted-foreground">No staff found.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredStaff.map((s) => (
              <StaffRow key={s.userId} member={s} />
            ))}
          </div>
        )}
      </section>

      {/* Customer section */}
      <section className="rounded-lg border p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Customer portal</h2>
          <input
            type="search"
            placeholder="Search customers…"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="rounded-md border border-black/20 dark:border-white/25 bg-transparent px-2 py-1 text-xs w-44 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Log in as a customer to see their portal view. If they have no portal account yet, one will be created automatically.
        </p>
        {filteredCustomers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No customers found.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredCustomers.map((c) => (
              <CustomerRow key={c.id} customer={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
