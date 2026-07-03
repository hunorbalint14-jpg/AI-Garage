import { listShares } from "@/lib/doc-shares";
import { ShareManager } from "./share-manager";

// Platform-admin page for minting + revoking signed share links to internal
// docs (technical reference, user manual). Access is gated by the /admin
// layout: reserved admin host + PLATFORM_ADMIN_EMAILS allowlist. The server
// actions re-check the allowlist themselves.
export default async function AdminDocSharesPage() {
  const shares = await listShares();

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-3xl text-[12.5px] text-[#9aa1ad]">
        Mint signed links that let external reviewers open internal AIGarage documents
        (technical reference, user manual) without a login. Links serve from the apex domain.
        Tokens are stored hashed — copy the URL when it appears; it cannot be retrieved later.
      </p>

      <ShareManager shares={shares} />
    </div>
  );
}
