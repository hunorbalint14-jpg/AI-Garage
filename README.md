# Garage-AI

AI-powered cloud SaaS for UK garages — MOT/service tracking, automated reminders, and AI-assisted client communication.

The app is multi-tenant (white-label per garage with custom subdomains and branding) and serves two audiences: garage staff and the garage's own customers (vehicle owners).

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **Supabase** (Postgres + Auth + Row-Level Security)
- **Claude API** (`@anthropic-ai/sdk`) for AI client communication
- **Resend** for email, **Twilio** for SMS
- **DVLA MOT History API** for UK vehicle data
- **Vercel** for hosting

## Getting started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Copy `.env.example` to `.env.local` and fill in the required keys before running.

## Project structure

- `src/app/(staff)` — garage staff portal (admin UI)
- `src/app/(customer)` — vehicle-owner portal
- `src/lib/supabase` — Supabase client/server helpers
- `src/middleware.ts` — subdomain → tenant resolution
- `supabase/migrations` — SQL migrations (schema + RLS policies)
