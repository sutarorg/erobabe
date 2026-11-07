-- Back to damplips: remove every trace of the Pornhub catalog.
--
-- The catalog is filled from damplips.com again. This migration is forward-only
-- and self-contained: it works whether or not `…29_pornhub_embeds.sql` was ever
-- applied to this database (that file has been withdrawn).
--
-- What it does:
--   1. deletes the Pornhub rows that migration 29 let the importer create, and
--      the retention notes those deletes would otherwise leave behind;
--   2. drops the Pornhub-only index and view;
--   3. restores `damplips` as the provider default and as the only catalog
--      source in the provider check;
--   4. re-creates the damplips identity index, category index and operator view.
--
-- Historical rows from retired upload providers keep their provider value, so
-- nothing that already exists is rewritten or rejected.
begin;

-- 1. Pornhub rows cannot be played once the embed path is gone, so they are
--    removed rather than left as dead catalog entries. The delete trigger writes
--    a `media_retention` note per row; those notes are removed too, because the
--    source itself is being withdrawn.
delete from public.videos where provider = 'pornhub';
delete from public.media_retention where provider = 'pornhub';

-- 2. Pornhub-only objects.
drop index if exists public.videos_pornhub_identity_idx;
drop index if exists public.videos_pornhub_category_idx;
drop view if exists public.pornhub_category_counts;

-- 3. damplips is the catalog source again.
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos add constraint videos_provider_check
  check (provider in (
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
alter table public.videos alter column provider set default 'damplips';

-- 4. Identity and read paths for damplips rows.
--
-- The unique index is what makes "no duplicates" a database guarantee rather
-- than a promise made by the importer: two runs racing on the same listing
-- cannot both insert the same post. Same shape as migration 26, so a database
-- that never left damplips sees no change.
create unique index if not exists videos_damplips_identity_idx
  on public.videos (provider, provider_file_id)
  where provider = 'damplips' and provider_file_id is not null;

create index if not exists videos_damplips_category_idx
  on public.videos (category_id, published_at desc)
  where provider = 'damplips';

update public.videos
set source_name = 'damplips'
where provider = 'damplips' and source_name is null;

-- Operator view: how much of each fixed category is actually filled.
create or replace view public.damplips_category_counts as
select
  c.id as category_id,
  c.label,
  c.slug,
  count(v.id) filter (
    where v.status = 'published'
      and v.visibility = 'public'
      and v.requires_reupload = false
      and not (v.playable_url is null and v.embed_url is null)
  )::int as published_count
from public.categories c
left join public.videos v
  on v.category_id = c.id
 and v.provider = 'damplips'
group by c.id, c.label, c.slug
order by c.label;

revoke all on public.damplips_category_counts from public, anon, authenticated;
grant select on public.damplips_category_counts to service_role;
grant select on public.damplips_category_counts to authenticated;

comment on view public.damplips_category_counts is
  'Per fixed category: published damplips videos with a playable destination.';

commit;
