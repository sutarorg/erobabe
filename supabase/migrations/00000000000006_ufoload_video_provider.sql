-- UFOLOAD becomes the active video-hosting provider.
--
-- Why a forward migration:
--   * the initial schema's provider check constraint lists 'uqload' and not
--     'ufoload', so new uploads would be rejected by the database;
--   * a direct upload is a two-step handshake, so the provider's *upload*
--     session id has to be stored while the bytes are still moving;
--   * a URL import answers with a task id that is not a file id and must not be
--     written into `provider_file_id`.
--
-- Everything here is additive and repeatable: existing rows, their provider ids
-- and their stored playback / embed URLs are left exactly as they are. Videos
-- that were uploaded through Uqload keep working as historical records; they are
-- never relabelled as UFOLOAD.

-- 1. New provider value ------------------------------------------------------
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos
  add constraint videos_provider_check
  check (provider in ('ufoload', 'uqload', 'bunny', 'cloudflare', 'internal', 's3', 'embed'));

-- 2. Provider identifiers ----------------------------------------------------
-- `provider_file_id` stays the actual file id (a ULID for UFOLOAD). The short
-- public identifier the player advertises is stored separately, when the
-- provider returns one, so the embed address can be rebuilt without guessing.
alter table public.videos
  add column if not exists provider_public_id text;

-- Percent reported by the provider while it encodes (0-99 until ready).
alter table public.videos
  add column if not exists provider_progress int;

-- Actionable, admin-facing reason a provider refused or failed to process a
-- video. Kept on the video so a failed upload is never shown as playable.
alter table public.videos
  add column if not exists provider_error text;

comment on column public.videos.provider_public_id is
  'Short public file identifier returned by the provider (UFOLOAD public_id), used for the stable embed URL.';
comment on column public.videos.provider_progress is
  'Encoding progress reported by the provider; 100 only when the provider reports the file as ready.';
comment on column public.videos.provider_error is
  'Provider-side failure reason shown to admins; the row stays private.';

-- 3. Upload-job provider bookkeeping ----------------------------------------
-- Direct uploads: the session id from `POST /api/v1/files/uploads`.
alter table public.upload_jobs
  add column if not exists provider_upload_id text;
-- URL imports: the task id from `POST /api/v1/files/import`, kept separate from
-- the file id the task eventually produces.
alter table public.upload_jobs
  add column if not exists provider_import_id text;
-- Last status the provider reported ('uploading' | 'queued' | 'processing' |
-- 'ready' | 'failed' for files; 'queued' | 'running' | 'done' | 'failed' |
-- 'cancelled' for imports).
alter table public.upload_jobs
  add column if not exists provider_status text;

create unique index if not exists upload_jobs_provider_upload_id_key
  on public.upload_jobs (provider_upload_id)
  where provider_upload_id is not null;

create index if not exists upload_jobs_provider_import_id_idx
  on public.upload_jobs (provider_import_id)
  where provider_import_id is not null;

-- Rows created before this migration are historical. Only the default for new
-- jobs changes; nothing is rewritten.
alter table public.upload_jobs
  alter column provider set default 'ufoload';

comment on column public.upload_jobs.provider_upload_id is
  'Provider direct-upload session id (UFOLOAD upload_id); the completion request is validated against it.';
comment on column public.upload_jobs.provider_import_id is
  'Provider URL-import task id (UFOLOAD import id) — never the resulting file id.';

-- 4. Lookups used while reconciling async work -------------------------------
-- The status endpoint finds work that is still in flight without scanning the
-- whole table, which keeps reconciliation cheap on a busy install.
create index if not exists videos_ufoload_processing_idx
  on public.videos (provider, status)
  where provider = 'ufoload' and status = 'processing';

create index if not exists upload_jobs_active_provider_idx
  on public.upload_jobs (provider, status)
  where status in ('pending', 'uploading', 'processing');
