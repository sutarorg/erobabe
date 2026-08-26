-- ═══════════════════════════════════════════════════════════════
-- EroBabe — SEO slugs for individual video pages
-- Run AFTER 0001_init.sql in: Supabase → SQL Editor → New query → Run
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

alter table public.videos add column if not exists slug text;

-- Backfill any existing rows: slugified title + short id suffix for uniqueness.
update public.videos
set slug = trim(both '-' from regexp_replace(lower(coalesce(nullif(title, ''), 'video')), '[^a-z0-9]+', '-', 'g'))
           || '-' || left(replace(id::text, '-', ''), 6)
where slug is null or slug = '';

create unique index if not exists videos_slug_key on public.videos (slug);

-- The public API resolves /watch/{slug} through this column.
grant select on public.videos to anon;
