import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, tenantBookingUrl, renderPlatformEmail, paragraphsToHtml } from "@/lib/email";
import { emailButton, emailBullets, emailSubheading, emailSteps, ACCENT_DEFAULT, type EmailStep } from "@/lib/email-layout";
import { loadSetupChecklistByIds } from "@/lib/setup-checklist";

// First-week activation sequence (#506 PR 4): day 1 / 3 / 7 touches to the org
// owner, ending the moment the garage actually trades. organizations.
// activation_stage counts sent touches (3 = done — also written on early stop,
// so a finished org is never reconsidered). Idempotent by stage: a missed day
// sends late, never twice.

type Admin = SupabaseClient;

export const TOUCH_DAYS = [1, 3, 7] as const;

// Which touch (0-based) is due now, or null. Pure — the cron's whole schedule
// hangs off this.
export function dueTouch(stage: number, createdAt: string, now: Date): number | null {
  if (stage < 0 || stage >= TOUCH_DAYS.length) return null;
  const days = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000);
  return days >= TOUCH_DAYS[stage] ? stage : null;
}

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  created_at: string;
  activation_stage: number;
  primary_location_id: string | null;
};

async function ownerContact(admin: Admin, organizationId: string): Promise<{ email: string; first: string } | null> {
  const { data: owner } = await admin
    .from("org_users")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const userId = (owner as { user_id: string } | null)?.user_id;
  if (!userId) return null;
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const user = u?.user;
  if (!user?.email) return null;
  const first =
    ((user.user_metadata?.full_name as string | undefined) ?? "").trim().split(/\s+/)[0] || "there";
  return { email: user.email, first };
}

// Real trading = any non-demo booking or invoice. Bookings carry no
// organization_id, so they scope through the org's locations.
async function hasActivated(admin: Admin, organizationId: string): Promise<boolean> {
  const { count: invoices } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("is_demo", false);
  if ((invoices ?? 0) > 0) return true;

  const { data: locs } = await admin.from("locations").select("id").eq("organization_id", organizationId);
  const locIds = ((locs ?? []) as { id: string }[]).map((l) => l.id);
  if (locIds.length === 0) return false;
  const { count: bookings } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .in("location_id", locIds)
    .eq("is_demo", false);
  return (bookings ?? 0) > 0;
}

// Exported for previews/tests; the sweep below is the only production caller.
export function touchEmail(
  touch: number,
  org: { slug: string; name: string },
  first: string,
  remainingSteps: { label: string; detail: string; href: string | null }[],
): { subject: string; html: string; text: string } {
  const url = (path: string) => tenantBookingUrl(org.slug, path);
  const bookingUrl = url("/book");

  if (touch === 0) {
    const intro = `Hi ${first},\n\nYour online booking page for ${org.name} is ready to share — customers can book day or night and it lands straight in your diary:`;
    const bullets = [
      "Pin it to your garage's Facebook page",
      "Add it as the website link on your Google Business Profile",
      "Put it in your WhatsApp auto-reply and email signature",
    ];
    return {
      subject: "Your booking page is live — here's where to put the link",
      html: renderPlatformEmail({
        preheader: "Share your booking link and let customers book themselves in.",
        badge: "Day one",
        heading: "Your booking page is live",
        bodyHtml:
          paragraphsToHtml(intro) +
          emailButton({ url: bookingUrl, label: "See your booking page" }, ACCENT_DEFAULT) +
          emailSubheading("Where the link earns its keep") +
          emailBullets(bullets, ACCENT_DEFAULT),
        footerNote: "Questions? Just reply — a human reads these.",
      }),
      text: `${intro}\n\n${bookingUrl}\n\nWhere the link earns its keep:\n${bullets.map((b) => `• ${b}`).join("\n")}`,
    };
  }

  if (touch === 1) {
    const intro = `Hi ${first},\n\nThe fastest way to feel AI Garage working is with your own customers in it. Two minutes each:`;
    const steps: EmailStep[] = [
      {
        title: "Add a customer & their vehicle",
        detail: "One reg plate is enough — MOT and tax dates fill in automatically from DVLA.",
        cta: { url: url("/staff/customers/new"), label: "Add a customer" },
      },
      {
        title: "Raise your first job & invoice",
        detail: "Open a job, add the work, and the invoice builds itself — email it or take card payment online.",
        cta: { url: url("/staff/jobs"), label: "Open the workshop board" },
      },
    ];
    return {
      subject: "Get your customers in — MOT dates fill themselves",
      html: renderPlatformEmail({
        preheader: "Add one customer and AI Garage starts working for you.",
        badge: "Day three",
        heading: "Put your customer book to work",
        bodyHtml: paragraphsToHtml(intro) + emailSteps(steps, ACCENT_DEFAULT),
        footerNote: "Reply if you'd like a hand importing a spreadsheet — we do it for you.",
      }),
      text: `${intro}\n\n${steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}\n   ${s.cta!.url}`).join("\n\n")}`,
    };
  }

  const intro = `Hi ${first},\n\nYou're most of the way there — a few steps left before ${org.name} runs itself:`;
  const steps: EmailStep[] = remainingSteps.slice(0, 4).map((s) => ({
    title: s.label,
    detail: s.detail,
    cta: s.href ? { url: url(s.href), label: "Do it now" } : undefined,
  }));
  return {
    subject: "A few steps left on your AI Garage setup",
    html: renderPlatformEmail({
      preheader: "Finish your setup — each step is a couple of minutes.",
      badge: "Day seven",
      heading: "Finish your setup",
      bodyHtml:
        paragraphsToHtml(intro) +
        (steps.length > 0 ? emailSteps(steps, ACCENT_DEFAULT) : "") +
        emailButton({ url: url("/staff"), label: "Open your dashboard" }, ACCENT_DEFAULT),
      footerNote: "Stuck on anything? Reply to this email and we'll walk it through with you.",
    }),
    text: `${intro}\n\n${steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}${s.cta ? `\n   ${s.cta.url}` : ""}`).join("\n\n")}\n\nDashboard: ${url("/staff")}`,
  };
}

export type ActivationSweepResult = {
  checked: number;
  sent: number;
  stopped: number;
  skipped: number;
  errors: string[];
};

// One pass over recent orgs. Bounded to the last 14 days of signups so
// pre-existing orgs never enter the sequence mid-life.
export async function runActivationSweep(admin: Admin, now = new Date()): Promise<ActivationSweepResult> {
  const results: ActivationSweepResult = { checked: 0, sent: 0, stopped: 0, skipped: 0, errors: [] };

  const cutoff = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const { data } = await admin
    .from("organizations")
    .select("id, slug, name, created_at, activation_stage, primary_location_id")
    .lt("activation_stage", TOUCH_DAYS.length)
    .gte("created_at", cutoff)
    .limit(200);

  for (const org of (data ?? []) as OrgRow[]) {
    results.checked++;
    try {
      const touch = dueTouch(org.activation_stage, org.created_at, now);
      if (touch === null) {
        results.skipped++;
        continue;
      }

      if (await hasActivated(admin, org.id)) {
        await admin.from("organizations").update({ activation_stage: TOUCH_DAYS.length }).eq("id", org.id);
        results.stopped++;
        continue;
      }

      // Checklist for the day-7 step list; null = complete or dismissed —
      // either way the owner has nothing left to be nudged about.
      const { data: loc } = org.primary_location_id
        ? { data: { id: org.primary_location_id } }
        : await admin.from("locations").select("id").eq("organization_id", org.id).limit(1).maybeSingle();
      const locationId = (loc as { id: string } | null)?.id;
      let remaining: { label: string; detail: string; href: string | null }[] = [];
      if (touch === 2) {
        const checklist = locationId
          ? await loadSetupChecklistByIds(admin, { organizationId: org.id, locationId, slug: org.slug })
          : null;
        if (!checklist) {
          await admin.from("organizations").update({ activation_stage: TOUCH_DAYS.length }).eq("id", org.id);
          results.stopped++;
          continue;
        }
        remaining = checklist.steps
          .filter((s) => !s.done && !s.optional)
          .map((s) => ({ label: s.label, detail: s.detail, href: s.href }));
      }

      const contact = await ownerContact(admin, org.id);
      if (!contact) {
        results.errors.push(`${org.slug}: no owner email`);
        continue;
      }

      const email = touchEmail(touch, org, contact.first, remaining);
      const sent = await sendEmail({ to: contact.email, subject: email.subject, text: email.text, html: email.html });
      if (!sent.success) {
        results.errors.push(`${org.slug}: ${sent.error}`);
        continue;
      }

      await admin.from("organizations").update({ activation_stage: touch + 1 }).eq("id", org.id);
      results.sent++;
    } catch (err) {
      results.errors.push(`${org.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}
