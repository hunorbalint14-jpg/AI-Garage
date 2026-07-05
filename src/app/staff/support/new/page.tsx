import { PageHeader } from "@/components/staff/page-header";
import { requireStaffContext } from "@/lib/staff-context";
import { TicketForm } from "./ticket-form";

export const dynamic = "force-dynamic";

export default async function NewTicketPage() {
  await requireStaffContext();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New support ticket"
        description="Goes straight to the AI Garage team — we'll reply here and by email."
      />
      <TicketForm />
    </div>
  );
}
