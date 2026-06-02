"use client";

import { useState, useTransition } from "react";

type Staff = { id: string; name: string };
type AssignResult = { error: string } | { success: true };

// Assignee dropdown shared by booking + job detail. The concrete server action
// (assignBookingTechnician / assignJobTechnician) is passed in — both have the
// signature (entityId, userId | null) => Promise<AssignResult>.
export function TechnicianSelector({
  entityId,
  staff,
  currentUserId,
  assignAction,
}: {
  entityId: string;
  staff: Staff[];
  currentUserId: string | null;
  assignAction: (entityId: string, userId: string | null) => Promise<AssignResult>;
}) {
  const [selected, setSelected] = useState(currentUserId ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleChange(value: string) {
    setSelected(value);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await assignAction(entityId, value || null);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    });
  }

  if (staff.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No staff to assign. <a href="/staff/staff-members" className="underline">Manage team →</a>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <select
        value={selected}
        onChange={(e) => handleChange(e.target.value)}
        disabled={pending}
        className="rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {pending && <span className="text-xs text-muted-foreground">Saving…</span>}
      {saved && <span className="text-xs text-green-600">Saved</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
