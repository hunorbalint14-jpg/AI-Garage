import { Mail } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalContext } from "@/lib/portal-auth";
import { PortalShell } from "../portal-shell";
import { ContactPrefsForm } from "./contact-prefs-form";

type PrefsRow = {
  marketing_email_consent: boolean | null;
  marketing_sms_consent: boolean | null;
  email: string | null;
  phone: string | null;
};

export default async function PortalSettingsPage() {
  const { location, customer } = await getPortalContext();
  const org = location.organization;

  if (!customer) {
    return (
      <PortalShell org={org}>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center backdrop-blur-sm">
          <p className="font-semibold">No account found</p>
          <p className="mt-2 text-sm text-gray-400">
            We couldn&apos;t find a customer record linked to your email. Please contact {org.name}.
          </p>
        </div>
      </PortalShell>
    );
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("customers")
    .select("marketing_email_consent, marketing_sms_consent, email, phone")
    .eq("id", customer.id)
    .maybeSingle();
  const prefs = (data ?? {}) as PrefsRow;

  return (
    <PortalShell org={org}>
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-gray-400">Manage how {org.name} contacts you.</p>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-gray-500">
          <Mail className="h-4 w-4" /> Contact preferences
        </h2>
        <ContactPrefsForm
          initialEmail={!!prefs.marketing_email_consent}
          initialSms={!!prefs.marketing_sms_consent}
          hasPhone={!!prefs.phone}
          orgColor={org.primary_color}
        />
      </section>
    </PortalShell>
  );
}
