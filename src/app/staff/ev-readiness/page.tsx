import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { listLocationStaff } from "@/lib/staff-directory";
import { PageHeader } from "@/components/staff/page-header";
import { isHvQualified, qualExpired } from "@/lib/ev-readiness";
import { SermiCard, type SermiView } from "./sermi-card";
import { QualsTable, type StaffQualView } from "./quals-table";

export const dynamic = "force-dynamic";

export default async function EvReadinessPage() {
  const ctx = await requireStaffContext();
  const canManage = ctx.orgRole === "owner" || ctx.orgRole === "admin";
  const admin = createAdminClient();

  const [readinessRes, qualsRes, staff] = await Promise.all([
    admin
      .from("location_ev_readiness")
      .select("sermi_status, sermi_reference, sermi_expires_at, notes")
      .eq("location_id", ctx.location.id)
      .maybeSingle(),
    admin
      .from("location_users")
      .select("user_id, ev_level, ev_certified_at, ev_expires_at")
      .eq("location_id", ctx.location.id),
    listLocationStaff(ctx.location.id, ctx.organization.id),
  ]);

  const sermi: SermiView = {
    status: (readinessRes.data?.sermi_status as SermiView["status"]) ?? "not_applied",
    reference: readinessRes.data?.sermi_reference ?? "",
    expiresAt: readinessRes.data?.sermi_expires_at ?? "",
    notes: readinessRes.data?.notes ?? "",
  };

  type QualRow = { user_id: string; ev_level: number | null; ev_certified_at: string | null; ev_expires_at: string | null };
  const qualByUser = new Map(
    ((qualsRes.data ?? []) as QualRow[]).map((q) => [q.user_id, q]),
  );

  const rows: StaffQualView[] = staff.map((s) => {
    const q = qualByUser.get(s.id);
    return {
      userId: s.id,
      name: s.name,
      level: q?.ev_level ?? 0,
      certifiedAt: q?.ev_certified_at ?? "",
      expiresAt: q?.ev_expires_at ?? "",
      expired: qualExpired(q?.ev_expires_at),
    };
  });

  const qualifiedCount = rows.filter((r) => isHvQualified(r.level) && !r.expired).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="EV readiness"
        description="SERMI accreditation and technician high-voltage qualifications — the compliance trail for the EV transition."
      />

      <SermiCard sermi={sermi} canManage={canManage} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Technician EV qualifications
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              qualifiedCount > 0 ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {qualifiedCount} HV-qualified
          </span>
        </div>
        <QualsTable rows={rows} />
        <p className="text-xs text-muted-foreground">
          Levels follow IMI TechSafe. Level 2 or above (in date) counts as qualified to work on a
          high-voltage vehicle — flag those jobs with the high-voltage toggle on the job card.
          {canManage && (
            <>
              {" "}Set each technician&apos;s qualification on the{" "}
              <Link href="/staff/staff-members" className="underline">Team page</Link>.
            </>
          )}
        </p>
      </section>
    </div>
  );
}
