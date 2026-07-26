-- Amber Alert / Safety updates
--
-- 1. RIDE no longer alerts nearby app users under any circumstance — only
--    the person's own emergency contacts (via WhatsApp, falling back to
--    SMS) are notified. This constraint blocks the old "public" share
--    scope at the DB level too, in case any older client build still
--    tries to use it. `not valid` so it doesn't choke on any historical
--    'public' rows — it only governs new inserts/updates going forward.
-- 2. Adds columns so each SOS event carries the message that was actually
--    sent and how many contacts were notified, so an admin dashboard has
--    something real to show beyond just "an alert happened."
--
-- As with the negotiation migration, this repo doesn't track prior
-- migrations (schema lives in the linked Supabase project), so double
-- check column/table names against your live schema before running.

alter table public.sos_alerts
  add constraint sos_alerts_no_public_scope
  check (share_scope = 'emergency_only') not valid;

alter table public.sos_alerts
  add column if not exists message_template text,
  add column if not exists message_body text,
  add column if not exists contacts_notified integer;

create or replace function public.record_sos_details(
  alert_id_in uuid,
  message_template_in text,
  message_body_in text,
  contacts_notified_in integer
) returns public.sos_alerts
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_alert public.sos_alerts;
begin
  update public.sos_alerts
  set message_template = message_template_in,
      message_body = message_body_in,
      contacts_notified = contacts_notified_in
  where id = alert_id_in
    and user_id = auth.uid()
  returning * into updated_alert;

  if updated_alert.id is null then
    raise exception 'Alert not found or not yours.';
  end if;

  return updated_alert;
end;
$$;

grant execute on function public.record_sos_details(uuid, text, text, integer) to authenticated;
