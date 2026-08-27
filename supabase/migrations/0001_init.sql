-- ============================================================
-- EroBabe — Supabase schema (run in the SQL editor or via CLI)
-- Metadata only. Video binaries live in Cloudflare R2.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- enums ----------
do $$ begin
  create type video_status as enum ('DRAFT','PROCESSING','READY','PUBLISHED','UNPUBLISHED','FAILED');
exception when duplicate_object then null; end $$;

-- ---------- videos ----------
create table if not exists public.videos (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  slug              text not null unique,
  description       text default '',
  category_slug     text,
  tags              text[] default '{}',
  performer         text default '',
  studio            text,
  quality           text default 'HD',
  duration_sec      int default 0,
  width             int,
  height            int,
  views             bigint default 0,
  -- storage references (Cloudflare R2 object keys / public URLs)
  thumbnail_url     text,
  poster_url        text,
  original_key      text,            -- originals/{id}/source.mp4
  playback_url      text,            -- MP4 fallback URL
  hls_master_url    text,            -- encoded/{id}/master.m3u8
  preview_url       text,
  -- publishing
  status            video_status not null default 'DRAFT',
  featured          boolean default false,
  trending          boolean default false,
  published_at      timestamptz,
  scheduled_at      timestamptz,
  error             text,
  -- seo
  seo_title         text,
  seo_description   text,
  canonical_url     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists videos_status_idx      on public.videos (status);
create index if not exists videos_category_idx    on public.videos (category_slug);
create index if not exists videos_published_idx   on public.videos (published_at desc);
create index if not exists videos_views_idx       on public.videos (views desc);

-- ---------- categories ----------
create table if not exists public.categories (
  slug          text primary key,
  name          text not null unique,
  blurb         text default '',
  description   text default '',
  image_url     text,
  accent        text default 'from-rose-600/60',
  seo_title     text,
  seo_description text,
  sort_order    int default 0,
  created_at    timestamptz not null default now()
);

-- ---------- tags (relational) ----------
create table if not exists public.tags (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.video_tags (
  video_id uuid references public.videos(id) on delete cascade,
  tag_id   bigint references public.tags(id) on delete cascade,
  primary key (video_id, tag_id)
);

-- ---------- view events (real analytics) ----------
create table if not exists public.view_events (
  id          bigint generated always as identity primary key,
  video_id    uuid references public.videos(id) on delete cascade,
  ts          timestamptz not null default now(),
  seconds     int default 0,
  session_id  text not null,        -- anonymous random id
  visitor_id  text,                 -- anonymous random id (no PII)
  ua_hash     text                  -- hashed UA for basic abuse heuristics
);
create index if not exists view_events_video_idx on public.view_events (video_id, ts desc);
create index if not exists view_events_ts_idx    on public.view_events (ts desc);

-- ---------- processing jobs ----------
create table if not exists public.processing_jobs (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid references public.videos(id) on delete cascade,
  provider    text not null,          -- 'ffmpeg-worker' | 'cloudflare-stream' | ...
  status      text not null default 'QUEUED', -- QUEUED RUNNING DONE FAILED CANCELLED
  progress    int default 0,
  outputs     jsonb default '{}',     -- { "360p": key, "720p": key, master: key }
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- site settings ----------
create table if not exists public.site_settings (
  key   text primary key,
  value jsonb not null
);

-- ---------- activity log ----------
create table if not exists public.activity_logs (
  id         bigint generated always as identity primary key,
  actor      text not null default 'admin',
  action     text not null,
  entity     text not null,
  entity_id  text,
  detail     text,
  ts         timestamptz not null default now()
);
create index if not exists activity_ts_idx on public.activity_logs (ts desc);

-- ---------- updated_at trigger ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists videos_touch on public.videos;
create trigger videos_touch before update on public.videos
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Row Level Security
--  • anon/public may ONLY read PUBLISHED videos + categories
--  • writes + all admin data flow through the service-role key
--    (server-side only — never shipped to the browser)
-- ============================================================
alter table public.videos          enable row level security;
alter table public.categories      enable row level security;
alter table public.tags            enable row level security;
alter table public.video_tags      enable row level security;
alter table public.view_events     enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.site_settings   enable row level security;
alter table public.activity_logs   enable row level security;

drop policy if exists "public read published videos" on public.videos;
create policy "public read published videos"
  on public.videos for select
  using (status = 'PUBLISHED');

drop policy if exists "public read categories" on public.categories;
create policy "public read categories"
  on public.categories for select using (true);

drop policy if exists "public read tags" on public.tags;
create policy "public read tags"
  on public.tags for select using (true);

drop policy if exists "public read video_tags" on public.video_tags;
create policy "public read video_tags"
  on public.video_tags for select using (true);

-- view_events: public insert of anonymous events allowed; no public read
drop policy if exists "public insert view events" on public.view_events;
create policy "public insert view events"
  on public.view_events for insert with check (true);

-- site_settings: public read (non-secret display config only)
drop policy if exists "public read settings" on public.site_settings;
create policy "public read settings"
  on public.site_settings for select using (true);

-- processing_jobs + activity_logs: no anon policies = service-role only

-- ---------- seed categories ----------
insert into public.categories (slug, name, blurb, sort_order) values
  ('studio','Studio','High-production scenes, cinematic lighting.',0),
  ('couples','Couples','Intimate duets and real chemistry.',1),
  ('solo','Solo','One performer. Full focus.',2),
  ('amateur','Amateur','Unpolished, authentic, self-shot.',3),
  ('premium','Premium','Flagship productions, exclusive cuts.',4),
  ('compilation','Compilation','Curated edits and best-of mixes.',5),
  ('cinematic','Cinematic','Story-driven, artfully shot films.',6),
  ('boudoir','Boudoir','Soft light, silk and slow tension.',7),
  ('noir','Noir','Dark rooms, neon and shadow play.',8),
  ('luxury','Luxury','Penthouse views, champagne moods.',9)
on conflict (slug) do nothing;

insert into public.site_settings (key, value) values
  ('site', '{"siteName":"EroBabe","siteTagline":"Premium adult video streaming"}'),
  ('age_gate', '{"enabled":true,"message":"You must be 18 years or older to enter EroBabe."}'),
  ('analytics', '{"viewsEnabled":true,"viewThresholdSec":10}')
on conflict (key) do nothing;

-- ---------- trending helper view ----------
create or replace view public.trending_videos as
select v.*,
       coalesce(recent.n, 0) as recent_views,
       coalesce(recent.n, 0)::float / power(greatest(extract(epoch from (now() - v.published_at))/86400, 0.4), 1.35) as trend_score
from public.videos v
left join lateral (
  select count(*) as n from public.view_events e
  where e.video_id = v.id and e.ts > now() - interval '7 days'
) recent on true
where v.status = 'PUBLISHED'
order by trend_score desc;

-- ---------- atomic view increment (used by POST /api/views) ----------
create or replace function public.increment_views(vid uuid)
returns void language sql security definer as $$
  update public.videos set views = views + 1 where id = vid;
$$;
