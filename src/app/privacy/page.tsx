import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — AI Garage",
  description: "How AI Garage and the garages using our platform handle your personal data.",
};

export default function PrivacyPolicyPage() {
  const lastUpdated = "May 2026";

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">← Back</Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: {lastUpdated}</p>

        <div className="prose prose-sm mt-8 max-w-none text-gray-700 space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Who we are</h2>
            <p>
              AI Garage is a software platform that helps UK independent garages manage their customers,
              bookings, vehicles, and communications. This default policy applies when a garage using our
              platform has not published their own privacy policy.
            </p>
            <p>
              <strong>The garage you book with is the data controller</strong> for your personal data.
              AI Garage is a <strong>data processor</strong> acting on the garage&apos;s instructions, providing
              the technical infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. What we collect</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Identity:</strong> Name, email, phone number</li>
              <li><strong>Vehicle:</strong> Registration plate, make, model, MOT/service/tax due dates</li>
              <li><strong>Service history:</strong> Bookings, jobs, invoices, payments</li>
              <li><strong>Communications:</strong> Messages we send you (email, SMS, WhatsApp) and your replies</li>
              <li><strong>Technical:</strong> IP address, browser type when using customer portal</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Why we use it (legal basis)</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Contract:</strong> Managing your bookings, sending appointment confirmations, issuing invoices</li>
              <li><strong>Legitimate interest:</strong> MOT/service/tax reminders (you can opt out)</li>
              <li><strong>Consent:</strong> Marketing communications (offers, news) — only sent if you opt in</li>
              <li><strong>Legal obligation:</strong> Keeping invoice records for tax compliance (HMRC: 6 years)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Who we share with</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Email delivery:</strong> Resend (resend.com) — sends transactional and marketing emails</li>
              <li><strong>SMS delivery:</strong> Twilio (twilio.com)</li>
              <li><strong>WhatsApp:</strong> Meta WhatsApp Business API</li>
              <li><strong>Hosting:</strong> Vercel (vercel.com) — runs the platform</li>
              <li><strong>Database:</strong> Supabase (supabase.com) — stores your data</li>
              <li><strong>AI message drafting:</strong> Anthropic Claude — drafts reminder text. No data sold or used to train models.</li>
              <li><strong>DVLA/DVSA:</strong> We query public vehicle records (MOT, road tax) using your registration plate</li>
            </ul>
            <p>We never sell your data. We never share for third-party advertising.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. How long we keep it</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Invoices and payment records:</strong> 6 years (HMRC requirement)</li>
              <li><strong>Customer profile and vehicle:</strong> 7 years from last service, then anonymized on request</li>
              <li><strong>Reminder/message history:</strong> 2 years</li>
              <li><strong>Marketing consent records:</strong> Until you withdraw consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Your rights (UK GDPR)</h2>
            <p>You can ask the garage to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Access</strong> — get a copy of your personal data</li>
              <li><strong>Rectify</strong> — correct anything inaccurate</li>
              <li><strong>Erase</strong> — delete your personal data (except records we&apos;re legally required to keep, like invoices)</li>
              <li><strong>Restrict</strong> — limit how we use it</li>
              <li><strong>Object</strong> — to direct marketing (we&apos;ll stop immediately)</li>
              <li><strong>Withdraw consent</strong> — at any time, for any consent-based processing</li>
              <li><strong>Data portability</strong> — receive your data in a machine-readable format</li>
            </ul>
            <p>
              Contact the garage directly to exercise these rights. If they cannot resolve your concern,
              you can complain to the UK Information Commissioner&apos;s Office (ICO):{" "}
              <a href="https://ico.org.uk/" className="underline" target="_blank" rel="noopener noreferrer">
                ico.org.uk
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Cookies</h2>
            <p>
              We use essential cookies to keep you logged in and remember your preferences. We do not use
              tracking, advertising, or analytics cookies that profile you.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Security</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Data is encrypted in transit (HTTPS) and at rest</li>
              <li>Access to the platform requires authentication; staff access to your records is restricted to the garage you booked with</li>
              <li>Passkey (WebAuthn) and email magic-link sign-in supported; passwords are stored hashed</li>
              <li>Staff sessions automatically expire 12 hours after sign-in, requiring re-authentication. This protects shared garage devices.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Contact</h2>
            <p>
              For data protection questions, contact the garage you booked with directly. For platform-level
              questions about AI Garage, email{" "}
              <a href="mailto:privacy@ai-garage.co.uk" className="underline">privacy@ai-garage.co.uk</a>.
            </p>
          </section>

          <section className="border-t pt-6 text-sm text-gray-500">
            <p>
              If the garage you booked with has published their own privacy policy, that policy applies
              instead of this one for matters specific to their data handling practices.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
