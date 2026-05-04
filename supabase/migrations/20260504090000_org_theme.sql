-- Staff portal theme preference per organisation.
-- 'dark'  : animated blobs + dark sidebar + light content panel (default)
-- 'light' : clean white, no animation
-- 'glass' : strong brand-colour blobs, transparent sidebar, glass content

alter table public.organizations
  add column if not exists portal_theme text not null default 'dark'
  check (portal_theme in ('dark', 'light', 'glass'));
