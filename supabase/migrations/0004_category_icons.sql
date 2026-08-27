-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0004: category icons + the 14 Explore categories
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all → Run
--   (Run 0001–0003 first. Safe to re-run.)
--
-- WHAT IT DOES
--   1. Adds categories.icon so admins can choose a glyph per category.
--   2. Seeds the 11 content categories shown on Explore
--      (Trending / Popular / New are curated collections rendered by
--      the front-end and are not stored as rows).
--   3. Retires the old default categories, but ONLY when no video
--      still references them — nothing with content is ever removed.
-- ═══════════════════════════════════════════════════════════════

-- 1. Icon column
alter table public.categories add column if not exists icon text;

-- 2. Seed the eleven content categories (existing rows are left untouched)
insert into public.categories (slug, name, blurb, gradient, icon, sort) values
  ('amateur',      'Amateur',      'Candid, unscripted energy.',              'from-amber-600/80 via-amber-900/40',   'camera',     10),
  ('hardcore',     'Hardcore',     'Intense, high-energy sessions.',          'from-red-600/80 via-red-900/40',       'zap',        20),
  ('young-18',     'Young 18+',    'Barely legal adults, verified 18 and over.','from-pink-600/80 via-pink-900/40',   'cake',       30),
  ('masturbation', 'Masturbation', 'Solo pleasure, intimate and unhurried.',  'from-purple-600/80 via-purple-900/40', 'hand',       40),
  ('lesbian',      'Lesbian',      'Women together, chemistry first.',        'from-rose-500/80 via-rose-900/40',     'venus',      50),
  ('threesome',    'Threesome',    'Three''s company — group encounters.',    'from-indigo-600/80 via-indigo-900/40', 'users',      60),
  ('ebony',        'Ebony',        'Stunning ebony performers.',              'from-zinc-500/70 via-zinc-800/40',     'moon',       70),
  ('creampie',     'Creampie',     'Finishing inside, up close.',             'from-sky-600/80 via-sky-900/40',       'droplets',   80),
  ('asian',        'Asian',        'Asian performers and productions.',       'from-emerald-600/80 via-emerald-900/40','flower',    90),
  ('massage',      'Massage',      'Oiled hands and slow, sensual bodywork.', 'from-teal-600/80 via-teal-900/40',     'hand-heart', 100),
  ('blonde',       'Blonde',       'Golden-haired favorites.',                'from-yellow-500/80 via-amber-900/40',  'sun',        110)
on conflict (slug) do nothing;

-- Backfill icons for any of the eleven that already existed without one.
update public.categories c
set icon = v.icon
from (values
  ('amateur','camera'), ('hardcore','zap'), ('young-18','cake'), ('masturbation','hand'),
  ('lesbian','venus'), ('threesome','users'), ('ebony','moon'), ('creampie','droplets'),
  ('asian','flower'), ('massage','hand-heart'), ('blonde','sun')
) as v(slug, icon)
where c.slug = v.slug and (c.icon is null or c.icon = '');

-- Give any other existing category a sensible default glyph.
update public.categories set icon = 'layers' where icon is null or icon = '';

-- 3. Retire the original demo categories only when they hold no videos.
delete from public.categories c
where c.slug in ('studio', 'premium', 'couples', 'solo', 'compilation')
  and not exists (select 1 from public.videos v where v.category_id = c.id);

-- Verify
select slug, name, icon, sort from public.categories order by sort, name;
