-- Supabase advisory (function_search_path_mutable): the three touch_*
-- trigger functions were created without a pinned search_path. They only do
-- `new.updated_at = now()` — no table references — so the empty search_path
-- is safe and satisfies the linter. Every other function already pins one.

alter function public.touch_job_quotes_updated_at() set search_path = '';
alter function public.touch_role_templates_updated_at() set search_path = '';
alter function public.touch_standalone_quotes_updated_at() set search_path = '';
