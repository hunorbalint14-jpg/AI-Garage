import { EV_LEVEL_LABELS, isHvQualified } from "@/lib/ev-readiness";

// Read-only roster of technician EV qualifications. Editing lives on the Team
// page (per-member, alongside the MOT flags); this is the location compliance
// at-a-glance view.

export type StaffQualView = {
  userId: string;
  name: string;
  level: number;
  certifiedAt: string;
  expiresAt: string;
  expired: boolean;
};

export function QualsTable({ rows }: { rows: StaffQualView[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No staff at this location yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Technician</th>
            <th className="px-3 py-2 font-medium">IMI TechSafe level</th>
            <th className="px-3 py-2 font-medium">Certified</th>
            <th className="px-3 py-2 font-medium">Expires</th>
            <th className="px-3 py-2 font-medium">HV status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const qualified = isHvQualified(row.level) && !row.expired;
            return (
              <tr key={row.userId} className="border-t">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-xs">
                  {row.level > 0 ? EV_LEVEL_LABELS[row.level] : "None"}
                </td>
                <td className="px-3 py-2 text-xs tabular-nums">{row.certifiedAt || "—"}</td>
                <td className="px-3 py-2 text-xs tabular-nums">{row.expiresAt || "—"}</td>
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
