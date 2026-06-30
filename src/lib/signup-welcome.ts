import { sendEmail, tenantBookingUrl, renderPlatformEmail, paragraphsToHtml } from "@/lib/email";
import {
  emailButton,
  emailSteps,
  emailBullets,
  emailSubheading,
  emailLink,
  ACCENT_DEFAULT,
  type EmailStep,
} from "@/lib/email-layout";

// ── New-org welcome ─────────────────────────────────────────────────────────
// Sent right after a garage signs up (signUpGarage), for every new org — they
// all start on the free Starter tier, so this is the platform's first contact.
// Branded as AI Garage. Warm confirmation → primary "Sign in" → a 3-step
// getting-started → what the product does → the plans (names + features, no
// prices) → help. The canonical onboarding email; paid-tier subscribers get a
// separate billing receipt, not a second getting-started.
//
// Best-effort: never throws (callers fire it via after() so it can't block the
// signup redirect).
export async function sendOrgWelcomeEmail(input: {
  ownerName: string;
  email: string;
  orgName: string;
  /** The org's subdomain — every link is scoped to the garage's own site. */
  slug: string;
}): Promise<void> {
  try {
    const { ownerName, email, orgName, slug } = input;
    const first = ownerName.trim().split(/\s+/)[0] || "there";

    const signInUrl = tenantBookingUrl(slug, `/staff/login?email=${encodeURIComponent(email)}`);
    const bookingUrl = tenantBookingUrl(slug, "/book");
    const billingUrl = tenantBookingUrl(slug, "/staff/settings/billing");

    const steps: EmailStep[] = [
      {
        title: "Finish your AI setup",
        detail: "Answer a few quick questions so AI Garage writes messages, quotes and diagnostics in your garage's voice.",
        cta: { url: tenantBookingUrl(slug, "/staff/onboarding"), label: "Open AI setup" },
      },
      {
        title: "Add your services & bays",
        detail: "List what you offer, your prices and your bays so bookings and invoices fill themselves in.",
        cta: { url: tenantBookingUrl(slug, "/staff/services"), label: "Add services" },
      },
      {
        title: "Share your booking link",
        detail: "Send customers your online booking page so they can book in day or night.",
        cta: { url: bookingUrl, label: "View your booking page" },
      },
    ];

    const valueBullets = [
      "Drafts customer messages, quotes and diagnostics with AI",
      "Sends MOT and service reminders automatically",
      "Takes online bookings and card payments",
      "Tracks jobs, invoices and revenue in one place",
    ];

    const tierBullets = [
      "Starter (your plan) — 1 branch, core tools",
      "Pro — up to 3 branches, plus Xero, campaigns & automations",
      "Growth — unlimited branches, plus the AI receptionist",
    ];

    const intro = `Hi ${first},\n\n${orgName} is all set up on AI Garage — welcome aboard. Sign in to your dashboard to get going:`;

    const seePlansLink = `<div style="margin-top:10px">${emailLink("See plans & pricing", billingUrl, ACCENT_DEFAULT)}</div>`;

    const bodyHtml =
      paragraphsToHtml(intro) +
      emailButton({ url: signInUrl, label: "Sign in to your dashboard" }, ACCENT_DEFAULT) +
      emailSubheading("Get started") +
      emailSteps(steps, ACCENT_DEFAULT) +
      emailSubheading("What you can do") +
      emailBullets(valueBullets, ACCENT_DEFAULT) +
      emailSubheading("Your plan") +
      emailBullets(tierBullets, ACCENT_DEFAULT) +
      seePlansLink;

    const html = renderPlatformEmail({
      preheader: "Your AI Garage account is ready — sign in to get started.",
      badge: "Account created",
      heading: "Welcome to AI Garage",
      bodyHtml,
      footerNote: "Questions getting set up? Just reply to this email.",
    });

    const text = [
      intro,
      `Sign in: ${signInUrl}`,
      "Get started:",
      steps.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}\n   ${s.cta!.url}`).join("\n\n"),
      `What you can do:\n${valueBullets.map((b) => `• ${b}`).join("\n")}`,
      `Your plan:\n${tierBullets.map((b) => `• ${b}`).join("\n")}\nSee plans & pricing: ${billingUrl}`,
      "Questions getting set up? Just reply to this email.",
    ].join("\n\n");

    const sent = await sendEmail({
      to: email,
      subject: `Welcome to AI Garage, ${orgName}`,
      text,
      html,
    });
    if (!sent.success) {
      console.error("[welcome] org: sendEmail failed", { to: email, slug, error: sent.error });
    }
  } catch (err) {
    console.error("[welcome] sendOrgWelcomeEmail threw", err);
  }
}
