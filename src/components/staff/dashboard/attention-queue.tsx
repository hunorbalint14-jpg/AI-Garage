import Link from "next/link";
import { dueDays, type AttentionVehicle } from "@/lib/dashboard";

function Plate({ reg }: { reg: string }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-[3px] border border-[#c9a435] bg-[#f4d35e] px-[7px] py-0.5 font-mono text-[11px] font-bold tracking-[0.06em] text-background">
      {reg}
    </span>
  );
}

const STATUS_BADGE = {
  overdue: { className: "border-[#5a2424] bg-[#3a1a1a] text-[#ff5b5b]", label: "OVERDUE" },
  urgent: { className: "border-[#5a4218] bg-[#3a2c14] text-[#ffb020]", label: "URGENT" },
  soon: { className: "border-[#2c4458] bg-[#1f2a35] text-[#7ec8ff]", label: "SOON" },
} as const;

function StatusBadge({ status }: { status: "overdue" | "urgent" | "soon" }) {
  const s = STATUS_BADGE[status];
  return (
    <span className={`rounded-[2px] border px-1.5 py-[3px] font-mono text-[10px] tracking-[0.12em] ${s.className}`}>
      {s.label}
    </span>
  );
}

export function AttentionQueue({
  vehicles,
  overdueCount,
  urgentCount,
}: {
  vehicles: AttentionVehicle[];
  overdueCount: number;
  urgentCount: number;
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[22px] py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Attention queue
          </div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {overdueCount} overdue · {urgentCount} within 14d ·{" "}
            {vehicles.length - overdueCount - urgentCount} upcoming
          </div>
        </div>
        <Link
          href="/staff/reminders"
          className="rounded-[2px] border border-[#3a2c14] bg-[#1c1810] px-3 py-1.5 font-mono text-[11px] text-[#ffb020] no-underline"
        >
          Send reminders →
        </Link>
      </div>

      {vehicles.length === 0 ? (
        <div className="px-[22px] py-8 text-center font-mono text-xs text-muted-foreground">
          {"// NO VEHICLES DUE WITHIN 60 DAYS"}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[130px_1fr_1fr_100px_100px_90px] border-b border-border px-[22px] py-2.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
            {["REG", "CUSTOMER", "VEHICLE", "MOT", "SERVICE", "STATUS"].map((col) => (
              <span key={col}>{col}</span>
            ))}
          </div>
          {vehicles.map((v, i) => {
            const motDays = v.mot_expiry ? dueDays(v.mot_expiry) : null;
            const svcDays = v.service_due ? dueDays(v.service_due) : null;
            const isOverdue =
              (motDays !== null && motDays < 0) || (svcDays !== null && svcDays < 0);
            const isUrgent =
              !isOverdue &&
              ((motDays !== null && motDays <= 14) || (svcDays !== null && svcDays <= 14));
            const status: "overdue" | "urgent" | "soon" = isOverdue
              ? "overdue"
              : isUrgent
              ? "urgent"
              : "soon";
            const motLabel =
              motDays === null ? "—" : motDays < 0 ? `${Math.abs(motDays)}d ago` : `+${motDays}d`;
            const svcLabel =
              svcDays === null ? "—" : svcDays < 0 ? `${Math.abs(svcDays)}d ago` : `+${svcDays}d`;
            const dueClass = (days: number | null) =>
              days !== null && days < 0
                ? "text-[#ff5b5b]"
                : days !== null && days <= 14
                ? "text-[#ffb020]"
                : "text-muted-foreground";
            return (
              <div
                key={v.id}
                className={`grid min-w-[720px] grid-cols-[130px_1fr_1fr_100px_100px_90px] items-center px-[22px] py-[11px] text-[13px] ${
                  i < vehicles.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div>
                  <Plate reg={v.registration} />
                </div>
                <div>
                  {v.customer ? (
                    <Link
                      href={`/staff/customers/${v.customer.id}`}
                      className="text-foreground no-underline"
                    >
                      {v.customer.full_name ?? "Unnamed"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {[v.make, v.model].filter(Boolean).join(" ") || "—"}
                </div>
                <div className={`font-mono text-xs ${dueClass(motDays)}`}>{motLabel}</div>
                <div className={`font-mono text-xs ${dueClass(svcDays)}`}>{svcLabel}</div>
                <div>
                  <StatusBadge status={status} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
