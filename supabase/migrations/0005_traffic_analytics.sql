-- ═══════════════════════════════════════════════════════════════
-- EroBabe — migration 0005: traffic sources & audience analytics
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → New query → paste all → Run
--   (Run 0001–0004 first. Safe to re-run.)
--
-- WHAT IT DOES
--   Records where each view came from (direct / search / social /
--   referral) plus the referring host and device class, powering the
--   Referral Sources, Traffic and Audience analytics in the CMS.
-- ═══════════════════════════════════════════════════════════════

alter table public.analytics_events add column if not exists source        text;
alter table public.analytics_events add column if not exists referrer_host text;
alter table public.analytics_events add column if not exists device        text;

create index if not exists analytics_source_idx on public.analytics_events (source, created_day);
create index if not exists analytics_ref_idx    on public.analytics_events (referrer_host);

-- View tracking, now with traffic attribution.
create or replace function public.track_view_src(v uuid, h text, s text, r text, d text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.analytics_events (video_id, viewer_hash, created_day, source, referrer_host, device)
  values (v, h, current_date, nullif(s, ''), nullif(r, ''), nullif(d, ''))
  on conflict (video_id, viewer_hash, created_day) do nothing;
  if found then
    update public.videos set views = views + 1 where id = v;
  end if;
end;
$$;

grant execute on function public.track_view_src(uuid, text, text, text, text) to anon;

select source, count(*) from public.analytics_events group by source;
