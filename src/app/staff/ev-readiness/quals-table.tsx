"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EV_LEVEL_LABELS, isHvQualified } from "@/lib/ev-readiness";
import { saveStaffQual } from "./actions";

const INPUT_CLASS =
  "rounded-md border border-black/20 dark:border-white/25 bg-background px-2 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export type StaffQualView = {
  userId: string;
  name: string;
  level: number;
  certifiedAt: string;
  expiresAt: string;
  expired: boolean;
};

export function QualsTable({ rows, canManage }: { rows: StaffQualView[]; canManage: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const userId = String(formData.get("userId") ?? "");
    startTransition(async () => {
      const result = await saveStaffQual(formData);
      if ("error" in result) setError(result.error);
      else {
        setSavedFor(userId);
        setTimeout(() => setSavedFor(null), 2000);
      }
    });
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No staff at this location yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Technician</th>
            <th className="px-3 py-2 font-medium">IMI TechSafe level</th>
            <th className="px-3 py-2 font-medium">Certified</th>
            <th className="px-3 py-2 font-medium">Expires</th>
            <th className="px-3 py-2 font-medium">HV status</th>
            {canManage && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const qualified = isHvQualified(row.level) && !row.expired;
            const formId = `qual-${row.userId}`;
            return (
              <tr key={row.userId} className="border-t">
                <td className="px-3 py-2">
                  {row.name}
                  {canManage && (
                    <form id={formId} onSubmit={handleSave}>
                      <input type="hidden" name="userId" value={row.userId} />
                    </form>
                  )}
                </td>
                {canManage ? (
                  <>
                    <td className="px-3 py-2">
                      <select name="level" form={formId} defaultValue={String(row.level)} className={INPUT_CLASS} disabled={pending}>
                        <option value="0">None</option>
                        {[1, 2, 3, 4].map((l) => (
                          <option key={l} value={l}>{EV_LEVEL_LABELS[l]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="date" name="certifiedAt" form={formId} defaultValue={row.certifiedAt} className={INPUT_CLASS} disabled={pending} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="date" name="expiresAt" form={formId} defaultValue={row.expiresAt} className={INPUT_CLASS} disabled={pending} />
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-xs">
                      {row.level > 0 ? EV_LEVEL_LABELS[row.level] : "None"}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">{row.certifiedAt || "—"}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{row.expiresAt || "—"}</td>
                  </>
                )}
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      qualified
                        ? "bg-green-100 text-green-700"
                        : row.expired
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {qualified ? "HV qualified" : row.expired ? "Expired" : "Not qualified"}
                  </span>
                </td>
                {canManage && (
                  <td className="px-3 py-2">
                    <Button type="submit" form={formId} size="sm" variant="outline" disabled={pending}>
                      {savedFor === row.userId ? "Saved" : "Save"}
                    </Button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
