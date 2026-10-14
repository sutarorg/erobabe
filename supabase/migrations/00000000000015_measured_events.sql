begin;
create table public.request_limits(key text primary key, window_at timestamptz not null, count integer not null);
alter table public.request_limits enable row level security;
create function public.consume_request(p_key text,p_limit integer) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 insert into request_limits values(p_key,date_trunc('minute',now()),1)
 on conflict(key) do update set window_at=excluded.window_at,count=case when request_limits.window_at=excluded.window_at then request_limits.count+1 else 1 end returning count into n;
 return n<=p_limit;
end $$;
revoke all on function public.consume_request(text,integer) from public,anon,authenticated;
grant execute on function public.consume_request(text,integer) to service_role;
create table public.ad_events(
 id uuid primary key, campaign_id uuid not null references campaigns(id) on delete cascade,
 slot_id integer not null references ad_slots(id), creative_id uuid not null references ad_creatives(id) on delete cascade,
 kind text not null check(kind in ('impression','click')), visitor_hash text not null,
 window_at timestamptz not null default date_trunc('hour',now()),created_at timestamptz not null default now(),
 unique(campaign_id,creative_id,kind,visitor_hash,window_at)
);
alter table public.ad_events enable row level security;
grant all on public.ad_events,public.request_limits to service_role;
create function public.record_ad_event(p_id uuid,p_campaign uuid,p_slot integer,p_creative uuid,p_kind text,p_visitor text) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if not exists(select 1 from eligible_ads where campaign_id=p_campaign and slot_id=p_slot and creative_id=p_creative) then return false; end if;
 insert into ad_events(id,campaign_id,slot_id,creative_id,kind,visitor_hash) values(p_id,p_campaign,p_slot,p_creative,p_kind,p_visitor) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return false; end if;
 update campaigns set impressions=impressions+case when p_kind='impression' then 1 else 0 end, clicks=clicks+case when p_kind='click' then 1 else 0 end where id=p_campaign;
 return true;
end $$;
revoke all on function public.record_ad_event(uuid,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_ad_event(uuid,uuid,integer,uuid,text,text) to service_role;
-- Delete short-lived pseudonymous evidence on an operator-scheduled daily job.
create function public.prune_measured_events() returns void language sql security definer set search_path=public as $$
 delete from ad_events where created_at<now()-interval '7 days';
 delete from request_limits where window_at<now()-interval '2 days';
$$;
revoke all on function public.prune_measured_events() from public,anon,authenticated;
grant execute on function public.prune_measured_events() to service_role;
create table public.measured_video_views(video_id uuid references videos(id) on delete cascade,visitor_hash text,created_at timestamptz not null default now(),primary key(video_id,visitor_hash));
alter table public.measured_video_views enable row level security;
grant all on public.measured_video_views to service_role;
create function public.record_video_view(p_video uuid,p_visitor text) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if not exists(select 1 from videos where id=p_video and status='published' and visibility='public' and rights_status='cleared' and moderation_status='approved' and not requires_reupload) then return false; end if;
 insert into measured_video_views(video_id,visitor_hash) values(p_video,p_visitor) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return false; end if;
 update videos set view_count=view_count+1 where id=p_video;
 return true;
end $$;
revoke all on function public.record_video_view(uuid,text) from public,anon,authenticated;
grant execute on function public.record_video_view(uuid,text) to service_role;
create or replace function public.prune_measured_events() returns void language sql security definer set search_path=public as $$
 delete from ad_events where created_at<now()-interval '7 days';
 delete from measured_video_views where created_at<now()-interval '7 days';
 delete from request_limits where window_at<now()-interval '2 days';
$$;
commit;
