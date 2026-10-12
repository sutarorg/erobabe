-- UFOLOAD video provider migration (additive — preserves all history).
--
-- Video upload and hosting move from Uqload to UFOLOAD.
--
--  * `videos.provider` also accepts 'ufoload'. 'uqload' stays valid: historical
--    Uqload videos are NEVER deleted or relabelled, and keep playing from their
--    stored `embed_url`.
--  * `upload_jobs.provider` defaults to 'ufoload' for new rows (it was 'uqload').
--    Existing rows keep whatever value they have.
--  * `upload_jobs` gains the identifiers UFOLOAD's flows need, each in its OWN
--    column so a task id is never confused with a file id:
--      provider_upload_id        direct-upload session (POST /api/v1/files/uploads)
--      provider_import_task_id   URL-import task      (POST /api/v1/files/import)
--      provider_file_id          the hosted file      (already existed)
--    plus `provider_status` (UFOLOAD's last reported status, for display and
--    diagnosis) and `last_checked_at` (when reconciliation last looked, which
--    also marks the last activity of a direct-upload session).
--
-- Safe to run on a deployed database and safe to run twice:
--  - no table is dropped, no row is deleted or updated;
--  - every column / index uses IF NOT EXISTS;
--  - the provider CHECK is only replaced when it does not already allow
--    'ufoload', and the replacement is a superset of the old one, so every
--    existing row still satisfies it;
--  - the new columns are nullable, so existing rows need no backfill.
--
-- RLS: `upload_jobs` is admin-only (policy "Admin can manage upload_jobs") and
-- the public `videos` policies are unchanged, so no policy change is needed.

-- 1. videos.provider: add 'ufoload', keep every existing value.
do $$
declare
  existing_definition text;
begin
  select pg_get_constraintdef(c.oid)
    into existing_definition
  from pg_constraint c
  where c.conrelid = 'public.videos'::regclass
    and c.conname = 'videos_provider_check';

  if existing_definition is null or existing_definition not like '%ufoload%' then
    alter table public.videos drop constraint if exists videos_provider_check;
    alter table public.videos
      add constraint videos_provider_check
      check (provider in ('uqload', 'ufoload', 'bunny', 'cloudflare', 'internal', 's3', 'embed'));
  end if;
end $$;

-- 2. New upload jobs belong to UFOLOAD unless the caller says otherwise.
alter table public.upload_jobs alter column provider set default 'ufoload';

-- 3. Provider identifiers and tracking columns.
alter table public.upload_jobs
  add column if not exists provider_upload_id text,
  add column if not exists provider_import_task_id text,
  add column if not exists provider_status text,
  add column if not exists last_checked_at timestamptz;

-- 4. One job per UFOLOAD upload session and per import task (NULLs are distinct,
--    so historical rows are unaffected), and fast lookups for reconciliation.
create unique index if not exists idx_upload_jobs_provider_upload_id
  on public.upload_jobs (provider_upload_id)
  where provider_upload_id is not null;

create unique index if not exists idx_upload_jobs_provider_import_task_id
  on public.upload_jobs (provider_import_task_id)
  where provider_import_task_id is not null;

create index if not exists idx_upload_jobs_unfinished
  on public.upload_jobs (provider, status, last_checked_at)
  where status in ('uploading', 'processing');

create index if not exists idx_videos_provider_file_id
  on public.videos (provider, provider_file_id)
  where provider_file_id is not null;

comment on column public.upload_jobs.provider_upload_id is 'UFOLOAD direct-upload session id (POST /api/v1/files/uploads). Never a file id.';
comment on column public.upload_jobs.provider_import_task_id is 'UFOLOAD URL-import task id (POST /api/v1/files/import). Never a file id; the resulting file id goes to provider_file_id.';
comment on column public.upload_jobs.provider_file_id is 'The file UFOLOAD actually hosts (file.id). For Uqload-era rows: the Uqload file code.';
comment on column public.upload_jobs.provider_status is 'Last status UFOLOAD reported (uploading|queued|processing|ready|failed, or import:<status> / upload:<state>).';
comment on column public.upload_jobs.last_checked_at is 'When reconciliation last asked UFOLOAD; also the last activity of a direct-upload session.';
