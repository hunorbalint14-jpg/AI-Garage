import Link from "next/link";
import { requireStaffContext } from "@/lib/staff-context";
import { PageHeader } from "@/components/staff/page-header";
import { ImportForm } from "./import-form";

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
        title="Import customers"
        description="Bulk import customers and vehicles from a CSV file."
      />
      <ImportForm />
    </div>
  );
}
