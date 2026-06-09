import { fetchActiveIncidents } from "@/lib/platform/incidents";
import { IncidentsPanel } from "@/components/admin/incidents-panel";

// Incident management — its own admin section. Declare / update / publish /
// resolve platform incidents. The title lives in the topbar (AdminTopbar).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function IncidentsPage() {
  const incidents = await fetchActiveIncidents();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[#9aa1ad]">
        Declare, track and publish platform incidents. Published incidents appear on the public status page.
      </p>
      <IncidentsPanel incidents={incidents} />
    </div>
  );
}
