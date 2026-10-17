import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, tenantBookingUrl, renderPlatformEmail, paragraphsToHtml } from "@/lib/email";
import { emailButton, emailBullets, emailDetails, emailSubheading, ACCENT_DEFAULT } from "@/lib/email-layout";
import { ownerContact } from "@/lib/activation-emails";
import { hasBilledSubscription } from "@/lib/courtesy-trial";
import { TIERS, TRIAL_ENDING_WINDOW_DAYS, type FeatureKey } from "@/lib/tenant-plans";

// "Your trial ends next week" — one email to the org owner, ~7 days before a
// courtesy trial (platform-admin granted, no card, #648) runs out. Without it
// the first a garage hears is the trial_ended banner, after its Pro / Growth
// features have already gone.
//
// Once per trial: organizations.tenant_trial_notice_for holds the
// tenant_trial_end the owner was emailed about. A re-granted trial has a new
// end date, so it gets its own notice with no reset step. Orgs Stripe bills
// (including a carried-over trial, which is `trialing`) are skipped — Stripe
// sends its own trial-ending reminder for those.

type Admin = SupabaseClient;

const DAY_MS = 86_400_000;

export type TrialOrg = {
  id: string;
  slug: string;
  name: string;
  tenant_plan: string | null;
  tenant_subscription_status: string | null;
  tenant_trial_end: string | null;
  tenant_trial_notice_for: string | null;
};

// Whether the owner is due the notice now. Pure — the sweep's whole schedule
// hangs off this. Late sends are fine (a missed 09:00 tick sends the next day,
// while the trial is still live); doubles are not.
export function trialNoticeDue(org: TrialOrg, now: Date): boolean {
  if (org.tenant_plan !== "pro" && org.tenant_plan !== "growth") return false;
  if (!org.tenant_trial_end || hasBilledSubscription(org)) return false;
  const end = new Date(org.tenant_trial_end).getTime();
  const left = end - now.getTime();
  if (Number.isNaN(end) || left <= 0 || left > TRIAL_ENDING_WINDOW_DAYS * DAY_MS) return false;
  // Compare instants, not strings: PostgREST returns "+00:00", JS writes "Z".
  return !org.tenant_trial_notice_for || new Date(org.tenant_trial_notice_for).getTime() !== end;
}

const FEATURE_LINES: Record<FeatureKey, string> = {
  accounting: "Xero, QuickBooks and Sage accounting sync",
  campaigns: "Marketing campaigns",
  automations: "Automations",
  receptionist: "The AI receptionist",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  });

// Exported for previews/tests; the sweep below is the only production caller.
// Names the tier and end date; deliberately no prices (they live on the
// billing page, which is the CTA).
export function trialEndingEmail(
  org: { slug: string; name: string; tier: "pro" | "growth"; trialEnd: string },
  first: string,
): { subject: string; html: string; text: string } {
  const tier = TIERS[org.tier];
  const ends = fmtDate(org.trialEnd);
  const billingUrl = tenantBookingUrl(org.slug, "/staff/settings/billing");
  const losing = (Object.keys(FEATURE_LINES) as FeatureKey[])
    .filter((f) => tier.features[f] && !TIERS.starter.features[f])
    .map((f) => FEATURE_LINES[f]);

  const intro =
    `Hi ${first},\n\n` +
    `The free ${tier.name} trial for ${org.name} ends on ${ends}. ` +
    `Nothing is charged when it ends — there's no card on file — but the account moves to Starter features and the Starter platform fee.`;
  const keep =
    `To keep ${tier.name}, pick a plan in Settings → Billing. ` +
    `Subscribe at least two days before the trial ends and the rest of it carries over: your first payment isn't taken until the day it ends.`;
  const safe = "Your jobs, invoices, customers and payments are never affected either way.";

  return {
    subject: `Your ${tier.name} trial ends on ${ends}`,
    html: renderPlatformEmail({
      preheader: `Your free ${tier.name} trial ends on ${ends}. Pick a plan to keep your features.`,
      badge: "Trial ending",
      heading: `Your ${tier.name} trial ends soon`,
      bodyHtml:
        paragraphsToHtml(intro) +
        emailDetails([
          { label: "Plan", value: `${tier.name} (free trial)` },
          { label: "Trial ends", value: ends },
        ]) +
        (losing.length > 0
          ? emailSubheading("What switches off when it ends") + emailBullets(losing, ACCENT_DEFAULT)
          : "") +
        paragraphsToHtml(keep) +
        emailButton({ url: billingUrl, label: `Keep ${tier.name}` }, ACCENT_DEFAULT) +
        paragraphsToHtml(safe),
      footerNote: "Questions about plans? Just reply — a human reads these.",
    }),
    text:
      `${intro}\n\n` +
      (losing.length > 0 ? `What switches off when it ends:\n${losing.map((l) => `• ${l}`).join("\n")}\n\n` : "") +
      `${keep}\n\n${billingUrl}\n\n${safe}`,
  };
}

export type TrialEndingSweepResult = { checked: number; sent: number; skipped: number; errors: string[] };

export async function runTrialEndingSweep(admin: Admin, now = new Date()): Promise<TrialEndingSweepResult> {
  const results: TrialEndingSweepResult = { checked: 0, sent: 0, skipped: 0, errors: [] };

  const { data, error } = await admin
    .from("organizations")
    .select("id, slug, name, tenant_plan, tenant_subscription_status, tenant_trial_end, tenant_trial_notice_for")
    .in("tenant_plan", ["pro", "growth"])
    .gt("tenant_trial_end", now.toISOString())
    .lte("tenant_trial_end", new Date(now.getTime() + TRIAL_ENDING_WINDOW_DAYS * DAY_MS).toISOString())
    .limit(500);
  if (error) {
    results.errors.push(`query: ${error.message}`);
    return results;
  }

  for (const org of (data ?? []) as TrialOrg[]) {
    results.checked++;
    try {
      if (!trialNoticeDue(org, now)) {
        results.skipped++;
        continue;
      }

      const contact = await ownerContact(admin, org.id);
      if (!contact) {
        results.errors.push(`${org.slug}: no owner email`);
        continue;
      }

      // Claim before sending, so an overlapping run (a retried tick) can't
      // send twice: only the run whose update still sees the old marker wins.
      const trialEnd = org.tenant_trial_end!;
      const claim = admin.from("organizations").update({ tenant_trial_notice_for: trialEnd }).eq("id", org.id);
      const { data: claimed, error: claimErr } = await (org.tenant_trial_notice_for
        ? claim.eq("tenant_trial_notice_for", org.tenant_trial_notice_for)
        : claim.is("tenant_trial_notice_for", null)
      ).select("id");
      if (claimErr) {
        results.errors.push(`${org.slug}: claim ${claimErr.message}`);
        continue;
      }
      if (!claimed || claimed.length === 0) {
        results.skipped++;
        continue;
      }

      const email = trialEndingEmail(
        { slug: org.slug, name: org.name, tier: org.tenant_plan as "pro" | "growth", trialEnd },
        contact.first,
      );
      const sent = await sendEmail({ to: contact.email, subject: email.subject, text: email.text, html: email.html });
      if (!sent.success) {
        // Release the claim so tomorrow's pass retries.
        await admin
          .from("organizations")
          .update({ tenant_trial_notice_for: org.tenant_trial_notice_for })
          .eq("id", org.id);
        results.errors.push(`${org.slug}: ${sent.error}`);
        continue;
      }
      results.sent++;
    } catch (err) {
      results.errors.push(`${org.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}
