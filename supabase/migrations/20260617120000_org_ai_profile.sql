-- Per-org AI profile captured during owner onboarding. The structured survey
-- answers (ai_profile) are distilled by Claude into a concise instructional
-- brief (ai_brief) that every AI feature — receptionist, message drafting,
-- diagnostics, labour estimates — injects into its system prompt so output is
-- tailored to the garage's services, tone, and what it does / doesn't offer.
-- ai_onboarded_at gates the dashboard for a new owner until the survey is done.
alter table public.organizations
  add column if not exists ai_profile jsonb,
  add column if not exists ai_brief text,
  add column if not exists ai_onboarded_at timestamptz;
