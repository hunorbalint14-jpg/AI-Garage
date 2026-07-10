-- Setup checklist (#506 PR 2): org-level dismissal marker. The checklist
-- itself is derived from real data at read time — this is the only state.
alter table public.organizations
  add column if not exists setup_checklist_dismissed_at timestamptz;
