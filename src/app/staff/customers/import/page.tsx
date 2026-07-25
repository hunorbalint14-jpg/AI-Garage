import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import { ImportWizard } from "./import-wizard";
import { isLocationLive } from "@/lib/prelive";

export default async function ImportPage() {
  const ctx = await requireStaffContext();
  // The import writes the very dates the reminder cron scans, so whether this
  // branch is live decides whether tomorrow morning is quiet or a mass send
  // (#585).
  const live = isLocationLive(ctx.activeLocation);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/staff/customers" className="text-sm text-muted-foreground underline">
          ← Back to customers
        </Link>
      </div>
      <PageHeader
        title="Import data"
        description="Bring customers, vehicles, service history and reminder dates over from your old system. Preview first — nothing is saved until you confirm."
      />
      {live ? (
        <div className="rounded-lg border border-ws-amber-border bg-ws-amber-bg px-4 py-3">
          <p className="text-sm font-medium text-ws-amber">{ctx.activeLocation.name} is live</p>
          <p className="mt-1 text-sm text-ws-text-2">
            Imported MOT, service and tax dates are picked up by the reminder run the next morning, so customers whose
            dates are already close will be messaged. That&apos;s usually what you want on an established branch — but
            if you&apos;re still setting up, import into a prelive branch instead and go live when you&apos;re ready.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-ws-blue-border bg-ws-blue-bg px-4 py-3">
          <p className="text-sm font-medium text-ws-blue">{ctx.activeLocation.name} is prelive — safe to import</p>
          <p className="mt-1 text-sm text-ws-text-2">
            Nothing you import here reaches a customer on its own. Load everything, check it, then go live when
            you&apos;re happy.
          </p>
        </div>
      )}
      <ImportWizard />
    </div>
  );
}
