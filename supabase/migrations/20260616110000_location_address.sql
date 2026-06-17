-- Per-branch postal address, surfaced in every client-facing communication so a
-- customer of a multi-location org knows which physical site to attend. Until
-- now comms only named the organisation (the brand), never the branch.
--
-- Freeform single text field (UK garages keep their address as one block); the
-- comms helper trims/normalises whitespace before printing. Nullable — single-
-- location orgs and not-yet-filled branches just omit the line.
alter table public.locations
  add column if not exists address text;
