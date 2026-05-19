import { requireStaffContext } from "@/lib/staff-context";
import { redirect } from "next/navigation";
import { listShares } from "@/lib/doc-shares";
import { ShareManager } from "./share-table";

// Owner-only page for minting + revoking signed share links to internal docs.
// Reachable at /staff/docs on any tenant subdomain.
//
// Access scope: scoped to the current organization. Org owners see and manage
// only their org's shares. Tighten this if a doc must be platform-only.

export default async function StaffDocsPage() {
  const ctx = await requireStaffContext();
  if (ctx.orgRole !== "owner") {
    redirect("/staff");
  }

  const shares = await listShares({ organizationId: ctx.organization.id });

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-neutral-500">
          Internal · doc shares
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Document share links
        </h1>
        <p className="mt-2 max-w-2xl text-neutral-600">
          Mint signed share links that let external reviewers view internal AIGarage
          documents (technical reference, runbooks, architecture notes) without a login.
          Tokens are stored hashed — copy the URL when it appears; you cannot retrieve it later.
        </p>
      </header>

      <ShareManager shares={shares} />
    </div>
  );
}
