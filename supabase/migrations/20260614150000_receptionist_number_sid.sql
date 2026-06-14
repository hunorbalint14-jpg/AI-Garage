-- Auto-provisioning of receptionist numbers: when the platform buys a Twilio
-- number for a location, keep its IncomingPhoneNumber SID so an operator can
-- later release it (Twilio's API releases by SID, not by E.164). Nullable —
-- numbers set by hand before this column existed simply have no SID.
alter table public.receptionist_configs
  add column if not exists twilio_number_sid text;
