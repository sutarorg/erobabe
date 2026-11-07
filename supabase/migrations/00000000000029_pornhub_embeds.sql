-- Pornhub embeds replace damplips as the catalog source.
--
-- The catalog now stores, per imported video, Pornhub's `viewkey` (the provider
-- identity), the poster the search listing advertises, and the embed URL built
-- from that viewkey. Nothing is copied: the watch page frames Pornhub's own
-- player.
--
-- This migration is forward-only and additive. Historical rows are untouched:
-- their `provider` values stay valid, and damplips media still plays through the
-- legacy direct-media path.
begin;

-- 1. `pornhub` becomes a valid provider, and the default for new rows.
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos add constraint videos_provider_check
  check (provider in (
    'pornhub',
    'damplips',
    'direct_url',
    'embed',
    'internal',
    's3',
    'cloudflare',
    'bunny',
    'uqload',
    'filekosh',
    'streamtape',
    'ufoload'
  ));
alter table public.videos alter column provider set default 'pornhub';

-- 2. A video is identified by its Pornhub viewkey, and by nothing else.
--
-- The unique index is what makes "no duplicates" a database guarantee rather
-- than a promise made by the importer: two runs racing on the same search page
-- cannot both insert the same video. The predicate keeps it scoped to imported
-- Pornhub rows, so historical rows with a NULL or reused `provider_file_id`
-- (retired upload providers) are never affected and the index builds cleanly on
-- an existing database.
create unique index if not exists videos_pornhub_identity_idx
  on public.videos (provider_file_id)
  where provider = 'pornhub' and provider_file_id is not null;

-- The category pages, the sitemap and the admin counters all read
-- "published Pornhub rows in this category, newest first".
create index if not exists videos_pornhub_category_idx
  on public.videos (category_id, published_at desc)
  where provider = 'pornhub';

-- Duplicate detection during an import looks rows up by identity with the
-- provider filter above; this is the index that lookup uses.

-- 3. Attribution on watch pages. Imported rows keep the page they came from, so
--    a takedown request can be traced back to the exact Pornhub URL.
update public.videos
set source_name = 'pornhub'
where provider = 'pornhub' and source_name is null;

-- 4. Operator view: how much of each fixed category is filled from Pornhub.
--    Same shape as the damplips view it replaces on the admin surfaces.
create or replace view public.pornhub_category_counts as
select
  c.id as category_id,
  c.label,
  c.slug,
  count(v.id) filter (
    where v.status = 'published'
      and v.visibility = 'public'
      and v.rights_status = 'cleared'
      and v.moderation_status = 'approved'
      and v.requires_reupload = false
      and (v.playable_url is not null or v.embed_url is not null)
  )::int as published_count
from public.categories c
left join public.videos v
  on v.category_id = c.id
 and v.provider = 'pornhub'
group by c.id, c.label, c.slug
order by c.label;

revoke all on public.pornhub_category_counts from public, anon, authenticated;
grant select on public.pornhub_category_counts to service_role;

comment on view public.pornhub_category_counts is
  'Per fixed category: published Pornhub embeds with a playable destination.';

comment on index public.videos_pornhub_identity_idx is
  'One row per Pornhub viewkey: the database-level guarantee that an import never duplicates a video.';

commit;
