-- Replace the HTTP sender with a recorder so tests can assert who got what.
create table public.push_log (id serial, tokens text[], title text, data jsonb);
create or replace function public._send_push_notification(tokens_in text[], title_in text, body_in text, data_in jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if tokens_in is null or array_length(tokens_in, 1) is null then return; end if;
  insert into public.push_log (tokens, title, data) values (tokens_in, title_in, data_in);
end $$;
