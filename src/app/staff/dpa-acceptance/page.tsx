import { requireStaffContext } from "@/lib/staff-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { CURRENT_DPA_VERSION, CURRENT_DPA_EFFECTIVE_DATE, isDpaAccepted } from "@/lib/dpa";
import { DpaBody } from "@/app/legal/dpa/page";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";

export default async function DpaAcceptancePage() {
  const ctx = await requireStaffContext();
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("dpa_version, dpa_accepted_at, dpa_accepted_by_user_id")
    .eq("id", ctx.organization.id)
    .single();

  const accepted = isDpaAccepted(org?.dpa_version);
  if (accepted) redirect("/staff");

  const canAccept = ctx.orgRole === "owner" || ctx.orgRole === "admin";

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="mx-auto max-w-3xl px-6">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">Accept Data Processing Agreement</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Version {CURRENT_DPA_VERSION} · Effective {CURRENT_DPA_EFFECTIVE_DATE}
            </p>
            <p className="mt-3 text-sm">
              Before using AI Garage to process customer data, you must accept this DPA. It defines our roles
              under UK GDPR — your garage is the <strong>data controller</strong>, AI Garage is the{" "}
              <strong>processor</strong>.
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto rounded border bg-muted/20 p-5 text-sm">
            <DpaBody />
          </div>

          {canAccept ? (
            <AcceptForm />
          ) : (
            <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              You don&apos;t have permission to accept this DPA. Ask the garage owner or an admin to sign in
              and accept it before continuing.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
