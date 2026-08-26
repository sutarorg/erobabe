-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0003: engagement signals for the ranking engine
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all → Run
--   (Run 0001 and 0002 first. Safe to re-run.)
--
-- WHAT IT DOES
--   Adds watch-time / completion tracking per viewer-day and a likes
--   counter, so Featured / Trending / Rising Now can be scored from
--   real performance instead of lifetime views alone.
-- ═══════════════════════════════════════════════════════════════

alter table public.analytics_events add column if not exists watch_seconds int not null default 0;
alter table public.analytics_events add column if not exists completion smallint not null default 0;
alter table public.videos            add column if not exists likes bigint not null default 0;

create index if not exists analytics_video_day_idx on public.analytics_events (video_id, created_day);

-- Upsert watch-time / completion for one viewer on one day (keeps the best value).
create or replace function public.track_engagement(v uuid, h text, w int, c int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analytics_events (video_id, viewer_hash, created_day, watch_seconds, completion)
  values (v, h, current_date, greatest(coalesce(w, 0), 0), least(greatest(coalesce(c, 0), 0), 100))
  on conflict (video_id, viewer_hash, created_day) do update
    set watch_seconds = greatest(analytics_events.watch_seconds, excluded.watch_seconds),
        completion    = greatest(analytics_events.completion, excluded.completion);
end;
$$;

-- Like / unlike counter used as an engagement signal.
create or replace function public.track_like(v uuid, delta int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.videos
  set likes = greatest(0, likes + case when delta >= 0 then 1 else -1 end)
  where id = v;
end;
$$;

grant execute on function public.track_engagement(uuid, text, int, int) to anon;
grant execute on function public.track_like(uuid, int) to anon;

select id, title, views, likes from public.videos order by created_at desc limit 10;
