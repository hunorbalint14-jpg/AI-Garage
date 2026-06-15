import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revokePlatformAdmin } from "./actions";
import { InviteForm, SetPasswordForm } from "./admins-forms";


type AdminRow = { user_id: string; invited_by: string | null; created_at: string };

export default async function AdminsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const [{ data: rows }, { data: list }] = await Promise.all([
    admin.from("platform_admins").select("user_id, invited_by, created_at").order("created_at", { ascending: true }),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const emailById = new Map((list?.users ?? []).map((u) => [u.id, u.email ?? "(unknown)"]));
  const admins = (rows ?? []) as AdminRow[];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[#9aa1ad]">
        Invited operators. They see this dashboard and act as an <strong>owner</strong> inside every garage&apos;s portal.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[#23272f] bg-[#15181d] p-4">
          <h2 className="mb-3 text-sm font-semibold">Invite an admin</h2>
          <InviteForm />
        </section>
        <section className="rounded-xl border border-[#23272f] bg-[#15181d] p-4">
          <h2 className="mb-1 text-sm font-semibold">Your password</h2>
          <p className="mb-3 text-xs text-[#5a6170]">Set or change the password for {user?.email}.</p>
          <SetPasswordForm />
        </section>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#23272f]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[#15181d] text-xs text-[#9aa1ad]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Added</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.user_id} className="border-t border-[#23272f]">
                <td className="px-3 py-2">
                  {emailById.get(a.user_id) ?? a.user_id}
                  {a.user_id === user?.id && <span className="ml-2 text-[10px] text-[#5a6170]">(you)</span>}
                </td>
                <td className="px-3 py-2 text-[#9aa1ad]">
                  {new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="px-3 py-2 text-right">
                  {a.user_id === user?.id ? (
                    <span className="text-xs text-[#5a6170]">—</span>
                  ) : (
                    <form action={revokePlatformAdmin.bind(null, a.user_id)} className="inline">
                      <button
                        type="submit"
                        className="rounded border border-[#5a2424] bg-[#3a1a1a] px-2 py-1 text-xs text-[#ff7b7b] hover:bg-[#481f1f]"
                      >
                        Revoke
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {admins.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-[#5a6170]">
                  No table-based admins yet. Env-allowlisted operators (PLATFORM_ADMIN_EMAILS) aren&apos;t listed here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
