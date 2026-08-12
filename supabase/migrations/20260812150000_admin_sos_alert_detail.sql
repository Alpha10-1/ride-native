-- Surfaces the SOS message detail added by 20260726090000_safety_updates.sql
-- (message_template, message_body, contacts_notified), which that
-- migration's own comment says was added specifically "so an admin
-- dashboard has something real to show beyond just 'an alert happened.'"
-- No admin surface ever read it. This is a separate, narrow RPC rather
-- than a change to get_sos_alerts, since that function's current body
-- isn't visible from this repo (schema lives in the linked Supabase
-- project) — safer to add a detail lookup than to guess-and-replace it.
create or replace function public.admin_get_sos_alert_detail(alert_id_in uuid)
returns table (
  message_template text,
  message_body text,
  contacts_notified integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Not authorized.';
  end if;

  return query
    select sa.message_template, sa.message_body, sa.contacts_notified
    from public.sos_alerts sa
    where sa.id = alert_id_in;
end;
$$;

grant execute on function public.admin_get_sos_alert_detail(uuid) to authenticated;
