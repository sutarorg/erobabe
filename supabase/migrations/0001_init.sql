-- ═══════════════════════════════════════════════════════════════
-- EroBabe CMS — initial schema (Supabase / Postgres)
-- Run in: Supabase Dashboard → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Categories ──
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  blurb       text,
  gradient    text not null default 'from-zinc-500/70 via-zinc-800/40',
  image_url   text,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ── Videos ──
create table if not exists public.videos (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  status          text not null default 'draft'
                  check (status in ('uploading','draft','processing','ready','published','unpublished')),
  category_id     uuid references public.categories(id) on delete set null,
  tags            text[] not null default '{}',
  duration_s      int,
  views           bigint not null default 0,
  like_ratio      int not null default 95,
  seo_title       text,
  seo_description text,

  -- media
  video_key       text,     -- live R2 object key
  upload_key      text,     -- in-flight upload object key
  upload_id       text,     -- in-flight multipart upload id
  video_url       text,     -- public playback URL (R2 public base + key)
  hls_url         text,     -- adaptive stream URL (when processing is configured)
  thumbnail_key   text,
  thumbnail_url   text,
  source_size     bigint not null default 0,
  content_type    text,
  renditions      jsonb not null default '[]'::jsonb,

  -- curation flags
  featured        bool not null default false,
  trending        bool not null default false,
  editors_pick    bool not null default false,

  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists videos_status_idx      on public.videos (status);
create index if not exists videos_published_idx   on public.videos (published_at desc);
create index if not exists videos_views_idx       on public.videos (views desc);
create index if not exists videos_category_idx    on public.videos (category_id);
create index if not exists videos_tags_gin        on public.videos using gin (tags);

-- ── Analytics (view events, deduped per viewer/day) ──
create table if not exists public.analytics_events (
  id          bigint generated always as identity primary key,
  video_id    uuid not null references public.videos(id) on delete cascade,
  viewer_hash text not null,
  created_day date not null default current_date,
  unique (video_id, viewer_hash, created_day)
);
create index if not exists analytics_day_idx on public.analytics_events (created_day);

-- ── Site settings ──
create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ── Activity / audit log ──
create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  actor      text not null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity_log (created_at desc);

-- ── Atomic view tracking (insert-or-ignore event, then bump counter) ──
create or replace function public.track_view(v uuid, h text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analytics_events (video_id, viewer_hash, created_day)
  values (v, h, current_date)
  on conflict do nothing;
  if found then
    update public.videos set views = views + 1 where id = v;
  end if;
end;
$$;

-- ══ Row Level Security ══
alter table public.videos           enable row level security;
alter table public.categories       enable row level security;
alter table public.analytics_events enable row level security;
alter table public.settings         enable row level security;
alter table public.activity_log     enable row level security;

-- Anonymous visitors may read ONLY published videos and categories.
-- All admin operations run through the service role in the serverless
-- functions (service role bypasses RLS), so no other policies are needed.
drop policy if exists "public_read_published_videos" on public.videos;
create policy "public_read_published_videos"
  on public.videos for select
  using (status = 'published');

drop policy if exists "public_read_categories" on public.categories;
create policy "public_read_categories"
  on public.categories for select
  using (true);

grant select on public.videos, public.categories to anon;
grant execute on function public.track_view(uuid, text) to anon;

-- ── Seed: categories matching the built-in demo slugs ──
insert into public.categories (slug, name, blurb, gradient, sort) values
  ('studio',      'Studio',      'Polished productions with a cinematic finish.',        'from-zinc-500/70 via-zinc-800/40',     10),
  ('premium',     'Premium',     'The flagship collection — slow, deliberate, gorgeous.','from-purple-600/80 via-purple-900/40', 20),
  ('couples',     'Couples',     'Shared moments, chemistry first.',                     'from-pink-600/80 via-pink-900/40',     30),
  ('solo',        'Solo',        'Intimate, understated, atmospheric.',                  'from-red-600/80 via-red-900/40',       40),
  ('amateur',     'Amateur',     'Candid, unscripted energy.',                           'from-amber-600/80 via-amber-900/40',   50),
  ('compilation', 'Compilation', 'Curated highlights and best-of cuts.',                 'from-indigo-600/80 via-indigo-900/40', 60)
on conflict (slug) do nothing;

insert into public.settings (key, value) values
  ('site', '{"site_title":"EroBabe","hero_enabled":true,"featured_video_id":null,"announcement":null,"age_text":null}'::jsonb)
on conflict (key) do nothing;
