import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import { ImportWizard } from "./import-wizard";

export default async function ImportPage() {
  await requireStaffContext();

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
      <ImportWizard />
    </div>
  );
}
