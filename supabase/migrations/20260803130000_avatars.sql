-- Profile photos for both riders and drivers (ProfileScreen.tsx is
-- shared between both). Unlike driver-documents (private, verification
-- staff only), avatars need to be publicly viewable — a rider needs to
-- see their driver's photo and vice versa — so this is a separate,
-- public-read bucket rather than reusing driver-documents.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

alter table public.profiles
  add column if not exists avatar_url text;

-- Anyone can view any avatar (public bucket, public read policy) — that's
-- the point, other ride parties need to see it. Writes are restricted to
-- the owner's own folder, same convention as the driver-documents bucket
-- (path prefixed with the uploader's own uid).
drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update their own avatar" on storage.objects;
create policy "users update their own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
