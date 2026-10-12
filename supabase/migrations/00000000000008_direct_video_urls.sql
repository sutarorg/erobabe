-- Add 'direct_url' as an allowed video provider.
--
-- This migration is additive, forward-only, and repeatable. It does not
-- touch existing rows, their provider ids, or their stored playback/embed
-- URLs. Videos published through Streamtape, UFOLOAD, Uqload, or any other
-- historical provider keep working as historical records.
--
-- The 'direct_url' provider means the admin pasted a direct MP4 link.
-- The browser plays the video straight from the original host — Erobabe
-- stores and serves only the URL, never the video bytes.

-- 1. Expand the videos provider constraint -------------------------------------
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos
  add constraint videos_provider_check
  check (provider in (
    'direct_url',
    'streamtape',
    'ufoload',
    'uqload',
    'bunny',
    'cloudflare',
    'internal',
    's3',
    'embed'
  ));

comment on column public.videos.playable_url is
  'Direct media URL the browser plays from. For direct_url videos this is the admin-supplied link; for Streamtape/UFOLOAD it was the provider address; for embed-only rows this is null.';

comment on column public.videos.embed_url is
  'Stable embed page URL (iframe source). For direct_url videos this is NULL — they use playable_url with a native <video> player. For embed-only rows this is the iframe src.';