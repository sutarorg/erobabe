-- Admin video tools: homepage carousel slots and duplicate-upload detection.
--
-- Additive, forward-only, and repeatable.
--
-- 1. carousel_position — the admin picks up to three videos (slots 1–3) for the
--    homepage hero carousel from /admin/videos. NULL = not in the carousel.
--    The partial unique index guarantees one video per slot.
-- 2. source_key — a normalised form of the video's source link (host + path,
--    lower-cased, no query string or fragment, no leading www.). Duplicate
--    uploads are detected by comparing this key, which is indexed.

alter table public.videos
  add column if not exists carousel_position smallint;

alter table public.videos drop constraint if exists videos_carousel_position_check;
alter table public.videos
  add constraint videos_carousel_position_check
  check (carousel_position is null or carousel_position between 1 and 3);

create unique index if not exists videos_carousel_position_key
  on public.videos (carousel_position)
  where carousel_position is not null;

comment on column public.videos.carousel_position is
  'Homepage hero carousel slot (1-3) chosen by the admin. NULL means the video is not in the carousel.';

alter table public.videos
  add column if not exists source_key text;

-- Backfill with the same normalisation lib/video/duplicates.ts applies in code:
-- strip query and fragment, lower-case, drop the scheme and a leading "www.".
update public.videos
set source_key = regexp_replace(
  lower(split_part(split_part(coalesce(playable_url, embed_url), '?', 1), '#', 1)),
  '^https?://(www\.)?',
  ''
)
where source_key is null
  and coalesce(playable_url, embed_url) is not null;

create index if not exists videos_source_key_idx on public.videos (source_key);

comment on column public.videos.source_key is
  'Normalised source link (host + path, lower-case, no query/fragment) used by the duplicate-upload detector.';
