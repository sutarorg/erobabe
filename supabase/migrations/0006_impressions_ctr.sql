-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0006: impressions & click-through rate
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all → Run
--   (Run 0001–0005 first. Safe to re-run.)
--
-- WHAT IT DOES
--   Counts how often each video is shown (impression) and how often it
--   is clicked, so CTR = clicks ÷ impressions can be reported per video
--   and across the catalog in the CMS analytics pages.
-- ═══════════════════════════════════════════════════════════════

alter table public.videos add column if not exists impressions bigint not null default 0;
alter table public.videos add column if not exists clicks      bigint not null default 0;

create index if not exists videos_impressions_idx on public.videos (impressions desc);
create index if not exists videos_clicks_idx      on public.videos (clicks desc);

-- Batched impressions: one call per page view keeps request counts low.
create or replace function public.track_impressions(ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if ids is null or array_length(ids, 1) is null then
    return 0;
  end if;
  update public.videos
  set impressions = impressions + 1
  where id = any(ids) and status = 'published';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.track_click(v uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if v is null then
    return;
  end if;
  update public.videos
  set clicks = clicks + 1
  where id = v and status = 'published';
end;
$$;

grant execute on function public.track_impressions(uuid[]) to anon;
grant execute on function public.track_click(uuid) to anon;

-- Verify
select id, title, impressions, clicks,
       case when impressions > 0
            then round((clicks::numeric / impressions) * 100, 2)
            else 0 end as ctr_pct
from public.videos
order by impressions desc
limit 20;
