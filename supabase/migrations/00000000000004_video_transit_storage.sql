-- Video uploads now stream from the browser straight into Supabase Storage and
-- are handed to Uqload as a remote import. This migration creates the private
-- transit bucket those uploads land in and records the object path on the
-- upload job so the file can be deleted once the provider has fetched it.
--
-- Why: Vercel functions reject any request body above 4.5 MB with a plain-text
-- "413 Request Entity Too Large", which the admin UI used to surface as
-- `Unexpected token 'R', "Request En"... is not valid JSON`.

-- 1. Private transit bucket. Objects are only ever reachable through a signed
--    URL minted server-side with the service role key.
insert into storage.buckets (id, name, public, file_size_limit)
values ('video-incoming', 'video-incoming', false, 2147483648)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- 2. Public thumbnail bucket (idempotent — it may already exist).
insert into storage.buckets (id, name, public, file_size_limit)
values ('video-thumbnails', 'video-thumbnails', true, 10485760)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- 3. Remember which transit object an upload job pulled from.
alter table public.upload_jobs
  add column if not exists storage_path text;

create index if not exists upload_jobs_storage_path_idx
  on public.upload_jobs (storage_path)
  where storage_path is not null;

-- 4. Thumbnails are readable by anyone (they appear on public pages); the
--    transit bucket stays private and service-role only.
drop policy if exists "video thumbnails are publicly readable" on storage.objects;
create policy "video thumbnails are publicly readable"
  on storage.objects for select
  using (bucket_id = 'video-thumbnails');

-- No select/insert policies for 'video-incoming': every read and write goes
-- through the service role key server-side, which bypasses RLS.
