-- Parts pricing (#567): banded cost→sell markup + a target margin the AI
-- part-suggestion guardrail warns under. Both nullable — absent = a single
-- default multiplier and no target flag.
alter table public.organizations
  add column if not exists parts_markup_rules jsonb,
  add column if not exists parts_target_margin_pct integer;
