import Link from "next/link";
import { CURRENT_DPA_VERSION, CURRENT_DPA_EFFECTIVE_DATE } from "@/lib/dpa";

export const metadata = {
  title: "Data Processing Agreement — AI Garage",
  description: "Contractual terms between AI Garage and the garages using our platform.",
};

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="AI Garage">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo/aigarage-logo-horizontal-on-light.svg" alt="AI Garage" className="h-8 w-auto" />
          </Link>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900">← Back</Link>
        </div>

        <h1 className="mt-10 text-3xl font-bold tracking-tight">Data Processing Agreement</h1>
        <p className="mt-2 text-sm text-gray-500">Version {CURRENT_DPA_VERSION} · Effective {CURRENT_DPA_EFFECTIVE_DATE}</p>

        <div className="prose prose-sm mt-8 max-w-none text-gray-700 space-y-6">
          <DpaBody />
        </div>
      </div>
    </div>
  );
}

export function DpaBody() {
  return (
    <>
      <section>
        <h2 className="text-lg font-semibold text-gray-900">1. Parties and roles</h2>
        <p>
          This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the agreement between AI Garage
          (&ldquo;Processor&rdquo;) and the garage business using the platform (&ldquo;Controller&rdquo;).
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Controller</strong> — your garage business — determines purposes and means of processing personal data of your customers</li>
          <li><strong>Processor</strong> — AI Garage — processes personal data on your documented instructions</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">2. Subject matter and duration</h2>
        <p>
          AI Garage processes personal data of your customers (name, contact details, vehicle information,
          service history, communications) for as long as you remain an active subscriber and for any
          retention period thereafter specified in this DPA.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">3. Nature and purpose of processing</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Storing customer and vehicle records</li>
          <li>Scheduling bookings and creating job cards</li>
          <li>Generating invoices and managing payments tracking</li>
          <li>Sending transactional and (with consent) marketing communications via email/SMS/WhatsApp</li>
          <li>Generating AI-drafted reminder text using Anthropic Claude</li>
          <li>Querying public DVLA/DVSA records using vehicle registration plates</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">4. Categories of data subjects and personal data</h2>
        <p><strong>Data subjects:</strong> your customers, their employees (for fleet accounts), and your staff users.</p>
        <p><strong>Personal data:</strong> name, email, phone, vehicle registration plate, MOT/service/tax dates, service history, payment status, message history, IP addresses (technical logs).</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">5. Processor obligations</h2>
        <p>AI Garage will:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Process personal data only on your documented instructions</li>
          <li>Ensure personnel with access are bound by confidentiality</li>
          <li>Implement appropriate technical and organisational security measures (encryption at rest and in transit, access controls, regular backups)</li>
          <li>Assist you in responding to data subject rights requests (access, erasure, portability, restriction)</li>
          <li>Notify you of any personal data breach without undue delay and within 48 hours of becoming aware</li>
          <li>Make available all information necessary to demonstrate compliance with this DPA</li>
          <li>Allow for and contribute to audits, including inspections, conducted by you or another auditor mandated by you (reasonable notice required)</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">6. Sub-processors</h2>
        <p>You authorise AI Garage to engage the following sub-processors:</p>
        <table className="w-full text-sm border border-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Sub-processor</th>
              <th className="px-3 py-2 text-left font-semibold">Purpose</th>
              <th className="px-3 py-2 text-left font-semibold">Location</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t"><td className="px-3 py-2">Supabase</td><td className="px-3 py-2">Database, authentication</td><td className="px-3 py-2">EU (Ireland)</td></tr>
            <tr className="border-t"><td className="px-3 py-2">Vercel</td><td className="px-3 py-2">Application hosting</td><td className="px-3 py-2">Global (EU primary)</td></tr>
            <tr className="border-t"><td className="px-3 py-2">Resend</td><td className="px-3 py-2">Email delivery</td><td className="px-3 py-2">US / EU</td></tr>
            <tr className="border-t"><td className="px-3 py-2">Twilio</td><td className="px-3 py-2">SMS delivery</td><td className="px-3 py-2">US / EU</td></tr>
            <tr className="border-t"><td className="px-3 py-2">Meta WhatsApp Business</td><td className="px-3 py-2">WhatsApp messaging</td><td className="px-3 py-2">Global</td></tr>
            <tr className="border-t"><td className="px-3 py-2">Anthropic</td><td className="px-3 py-2">AI message drafting (Claude API)</td><td className="px-3 py-2">US</td></tr>
            <tr className="border-t"><td className="px-3 py-2">DVLA / DVSA</td><td className="px-3 py-2">Public vehicle records lookup</td><td className="px-3 py-2">UK</td></tr>
          </tbody>
        </table>
        <p>
          AI Garage will notify you at least 30 days in advance of adding or replacing sub-processors. You may
          object on reasonable data protection grounds. International transfers rely on UK adequacy decisions or
          Standard Contractual Clauses where required.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">7. Data subject rights</h2>
        <p>
          The platform provides built-in tools for you to fulfil data subject requests: data export (JSON),
          consent management, PII anonymisation, and hard deletion (where no legal retention obligation exists).
          AI Garage will not respond directly to your customers&apos; data subject requests.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">8. Security measures</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>TLS encryption for all data in transit</li>
          <li>Encryption at rest for database storage (Supabase/AES-256)</li>
          <li>Role-based access control with least-privilege defaults</li>
          <li>Multi-tenant data isolation via row-level security</li>
          <li>Daily automated backups with point-in-time recovery</li>
          <li>Audit logs of administrative actions including data deletions</li>
          <li>Phishing-resistant authentication via WebAuthn passkeys, alongside email magic-link sign-in</li>
          <li>Absolute session lifetime of 12 hours; users must re-authenticate at least daily</li>
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">9. Return and deletion on termination</h2>
        <p>
          On termination, AI Garage will, at your choice, return all personal data or delete it within 30 days,
          unless retention is required by law (e.g., HMRC requires invoice records for 6 years). You may export
          your data at any time using the built-in export tools.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">10. International transfers</h2>
        <p>
          Where personal data is transferred outside the UK or EEA (e.g., to sub-processors in the US),
          AI Garage relies on UK Adequacy Regulations or Standard Contractual Clauses approved by the UK
          ICO or EU Commission.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">11. Liability</h2>
        <p>
          Each party&apos;s liability under this DPA is subject to the limitations and exclusions set out in
          the main service agreement between you and AI Garage.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">12. Governing law</h2>
        <p>
          This DPA is governed by the laws of England and Wales. Disputes are subject to the exclusive
          jurisdiction of the English courts.
        </p>
      </section>

      <section className="border-t pt-6 text-sm text-gray-500">
        <p>
          By accepting this DPA in the platform settings, the accepting user confirms they have authority
          to bind the garage business. The acceptance is recorded with the user identity and timestamp for
          audit purposes.
        </p>
      </section>
    </>
  );
}
