-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0002: SEO slugs for individual video pages
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all of this → Run
--   (Run 0001_init.sql first if you have not already. Safe to re-run.)
--
-- WHAT IT DOES
--   Adds videos.slug so each video gets its own page at /watch/{slug}
--   and appears in the dynamic sitemap. Existing videos are backfilled
--   from their titles. Nothing is deleted and no data is lost.
-- ═══════════════════════════════════════════════════════════════

-- 1. Add the column (no-op if it already exists).
alter table public.videos add column if not exists slug text;

-- 2. Backfill: slugified title + short id suffix, guaranteeing uniqueness.
update public.videos
set slug =
  nullif(
    trim(both '-' from regexp_replace(lower(coalesce(nullif(title, ''), 'video')), '[^a-z0-9]+', '-', 'g')),
    ''
  ) || '-' || left(replace(id::text, '-', ''), 6)
where slug is null or slug = '';

-- 3. Safety net: resolve any duplicates before adding the unique index.
with dupes as (
  select id, row_number() over (partition by slug order by created_at, id) as rn
  from public.videos
)
update public.videos v
set slug = v.slug || '-' || left(replace(v.id::text, '-', ''), 4)
from dupes d
where v.id = d.id and d.rn > 1;

-- 4. Enforce uniqueness and index lookups by slug.
create unique index if not exists videos_slug_key on public.videos (slug);

grant select on public.videos to anon;

-- 5. Verify — every row should show a slug.
select id, title, slug, status from public.videos order by created_at desc limit 20;
