import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/staff-context";
import { BranchSelect } from "./branch-select";

export const dynamic = "force-dynamic";

// Shown right after sign-in. A user who can act in more than one branch picks
// which to work in; everyone else (single-location org, or staff with access to
// just one branch) is sent straight through — getStaffContext already defaults
// the active branch, so no choice is needed.
export default async function SelectBranchPage() {
  const ctx = await requireStaffContext();

  if (ctx.accessibleLocations.length <= 1) {
    redirect("/staff");
  }

  return (
    <BranchSelect
      branches={ctx.accessibleLocations}
      currentId={ctx.activeLocation.id}
      orgName={ctx.organization.name}
      brandColor={ctx.branding.primaryColor ?? "#6366f1"}
      logoUrl={ctx.branding.logoUrl}
    />
  );
}
