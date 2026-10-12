-- Streamtape becomes the active video-hosting provider.
--
-- Why a forward migration:
--   * the provider check constraint (from 00000000000006) lists 'ufoload' and
--     not 'streamtape', so new uploads would be rejected by the database;
--   * new upload jobs should default to the active integration.
--
-- Everything here is additive and repeatable: existing rows, their provider ids
-- and their stored playback / embed URLs are left exactly as they are. Videos
-- uploaded through UFOLOAD or Uqload keep working as historical records; they
-- are never relabelled as Streamtape, and no code path contacts their retired
-- provider APIs (see app/api/videos/status/route.ts).
--
-- No new columns are required: the Streamtape lifecycle reuses the generic
-- bookkeeping added by 00000000000004/00000000000006
-- (upload_jobs.provider_upload_id = upload session id,
--  upload_jobs.provider_import_id = remotedl task id,
--  upload_jobs.provider_status / videos.provider_public_id /
--  videos.provider_progress / videos.provider_error).

-- 1. New provider value ------------------------------------------------------
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos
  add constraint videos_provider_check
  check (provider in ('streamtape', 'ufoload', 'uqload', 'bunny', 'cloudflare', 'internal', 's3', 'embed'));

-- 2. Upload jobs default to the active integration ---------------------------
-- Only the default for *new* rows changes; historical rows are untouched.
alter table public.upload_jobs
  alter column provider set default 'streamtape';

comment on column public.upload_jobs.provider_upload_id is
  'Provider direct-upload session id (Streamtape upload session; UFOLOAD upload_id for legacy rows). The completion request is validated against it.';
comment on column public.upload_jobs.provider_import_id is
  'Provider remote-import task id (Streamtape remotedl id; UFOLOAD import id for legacy rows) — never the resulting file id.';

-- 3. Lookups used while reconciling async work -------------------------------
-- The status endpoint finds work that is still in flight without scanning the
-- whole table, which keeps reconciliation cheap on a busy install.
create index if not exists videos_streamtape_processing_idx
  on public.videos (provider, status)
  where provider = 'streamtape' and status = 'processing';

-- Legacy UFOLOAD rows are never reconciled against the retired API, but the
-- admin status route still looks them up by id — keep that path indexed.
create index if not exists videos_legacy_provider_idx
  on public.videos (provider, status)
  where provider in ('ufoload', 'uqload') and status = 'processing';
