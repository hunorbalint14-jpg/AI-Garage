"use client";

import React, { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export type AuditRow = {
  id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

const ENTITY_LINK: Record<string, (id: string) => string> = {
  job: (id) => `/staff/jobs/${id}`,
  job_quote: (id) => `/staff/job-quotes/${id}`,
  standalone_quote: (id) => `/staff/quotes/${id}`,
  customer: (id) => `/staff/customers/${id}`,
  invoice: (id) => `/staff/invoices/${id}`,
  booking: (id) => `/staff/bookings/${id}`,
};

function fmtTime(s: string): string {
  return new Date(s).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function AuditTable({ rows, initialActor }: { rows: AuditRow[]; initialActor: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [actor, setActor] = useState(initialActor);
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyActorFilter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (actor.trim()) params.set("actor", actor.trim()); else params.delete("actor");
    params.delete("cursor");
    startTransition(() => router.push(`/staff/audit-log?${params.toString()}`));
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={applyActorFilter} className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="Filter by actor email…"
            className="pl-8"
          />
        </div>
      </form>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="w-6 px-2 py-2"></th>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Actor</th>
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isExpanded = expanded.has(r.id);
              const linkBuilder = r.entity_type ? ENTITY_LINK[r.entity_type] : null;
              const entityHref = linkBuilder && r.entity_id ? linkBuilder(r.entity_id) : null;
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t hover:bg-muted/20">
                    <td className="px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => toggle(r.id)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                    <td className="px-3 py-2 text-xs">{r.actor_email ?? <span className="text-muted-foreground italic">system</span>}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.entity_type ? (
                        <>
                          <span className="text-muted-foreground">{r.entity_type}</span>
                          {entityHref && r.entity_id && (
                            <a href={entityHref} className="ml-1 underline text-xs">↗</a>
                          )}
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.ip_address ?? "—"}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-muted/20 border-t">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="text-xs space-y-1">
                          {r.entity_id && (
                            <div><span className="text-muted-foreground">entity_id:</span> <span className="font-mono">{r.entity_id}</span></div>
                          )}
                          {r.user_agent && (
                            <div><span className="text-muted-foreground">user_agent:</span> <span className="text-xs">{r.user_agent}</span></div>
                          )}
                          <div className="text-muted-foreground">metadata:</div>
                          <pre className="text-xs bg-background border rounded p-2 overflow-x-auto">{JSON.stringify(r.metadata ?? {}, null, 2)}</pre>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

