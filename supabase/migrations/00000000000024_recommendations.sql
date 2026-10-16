-- First-party, consent-gated recommendation data. Never reuse community/comment hashes.
begin;

create index if not exists videos_recommendation_likes
  on public.videos(like_count desc, id asc)
  where status='published' and visibility='public' and rights_status='cleared'
    and moderation_status='approved' and not requires_reupload;
create index if not exists videos_recommendation_category_latest
  on public.videos(category_id, published_at desc, id desc)
  where status='published' and visibility='public' and rights_status='cleared'
    and moderation_status='approved' and not requires_reupload;
create index if not exists video_tags_tag_video on public.video_tags(tag_id, video_id);

create table public.recommendation_preferences (
  viewer_hash text primary key check (viewer_hash ~ '^[0-9a-f]{64}$'),
  personalization_enabled boolean not null default true,
  preferred_category_ids uuid[] not null default '{}',
  suppressed_category_ids uuid[] not null default '{}',
  consent_expires_at timestamptz not null default (now() + interval '180 days'),
  updated_at timestamptz not null default now()
);

create table public.recommendation_feedback (
  viewer_hash text not null check (viewer_hash ~ '^[0-9a-f]{64}$'),
  video_id uuid not null references public.videos(id) on delete cascade,
  feedback text not null check (feedback in ('interested','not_interested','show_less')),
  updated_at timestamptz not null default now(),
  primary key (viewer_hash, video_id)
);
create index recommendation_feedback_viewer_updated
  on public.recommendation_feedback(viewer_hash, updated_at desc);

create table public.recommendation_events (
  id uuid primary key default gen_random_uuid(),
  viewer_hash text not null check (viewer_hash ~ '^[0-9a-f]{64}$'),
  video_id uuid not null references public.videos(id) on delete cascade,
  event_type text not null check (event_type in (
    'impression','card_select','playback_start','progress_25','progress_50',
    'progress_75','playback_complete','playback_error','like','unlike'
  )),
  surface text not null check (surface in ('home','up_next','recommended','featured','most_liked','watch')),
  position smallint check (position is null or position between 0 and 99),
  algorithm_version text not null check (length(algorithm_version) between 1 and 40),
  correlation_id uuid not null,
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  unique (viewer_hash, idempotency_key)
);
create index recommendation_events_viewer_recent
  on public.recommendation_events(viewer_hash, created_at desc)
  include (video_id, event_type, surface);
create index recommendation_events_retention
  on public.recommendation_events(created_at);

alter table public.recommendation_preferences enable row level security;
alter table public.recommendation_feedback enable row level security;
alter table public.recommendation_events enable row level security;
revoke all on public.recommendation_preferences, public.recommendation_feedback,
  public.recommendation_events from public, anon, authenticated;
grant select, insert, update, delete on public.recommendation_preferences,
  public.recommendation_feedback, public.recommendation_events to service_role;

create or replace function public.set_recommendation_feedback(p_viewer text, p_video uuid, p_feedback text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_feedback not in ('interested','not_interested','show_less') then raise exception 'Invalid feedback'; end if;
  if not exists(select 1 from videos where id=p_video and status='published' and visibility='public' and rights_status='cleared' and moderation_status='approved' and not requires_reupload and (playable_url is not null or embed_url is not null or (provider='bunny' and provider_file_id is not null and bunny_library_id is not null))) then raise exception 'Video unavailable'; end if;
  insert into recommendation_feedback(viewer_hash,video_id,feedback,updated_at)
  values(p_viewer,p_video,p_feedback,now())
  on conflict(viewer_hash,video_id) do update set feedback=excluded.feedback,updated_at=now();
end $$;
revoke all on function public.set_recommendation_feedback(text,uuid,text) from public,anon,authenticated;
grant execute on function public.set_recommendation_feedback(text,uuid,text) to service_role;

create or replace function public.suppress_recommendation_category(p_viewer text, p_video uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_category uuid;
begin
  select category_id into v_category from videos where id=p_video and status='published' and visibility='public' and rights_status='cleared' and moderation_status='approved' and not requires_reupload and (playable_url is not null or embed_url is not null or (provider='bunny' and provider_file_id is not null and bunny_library_id is not null));
  if not found or v_category is null then raise exception 'Video unavailable'; end if;
  update recommendation_preferences set suppressed_category_ids=array(select distinct unnest(suppressed_category_ids || v_category)),updated_at=now(),consent_expires_at=now()+interval '180 days' where viewer_hash=p_viewer;
end $$;
revoke all on function public.suppress_recommendation_category(text,uuid) from public,anon,authenticated;
grant execute on function public.suppress_recommendation_category(text,uuid) to service_role;

create or replace function public.record_recommendation_event(
  p_viewer text, p_video uuid, p_type text, p_surface text, p_position smallint,
  p_version text, p_correlation uuid, p_idempotency text
) returns boolean language plpgsql security definer set search_path = public as $$
declare inserted_count integer;
begin
  if not exists(select 1 from videos where id=p_video and status='published' and visibility='public' and rights_status='cleared' and moderation_status='approved' and not requires_reupload and (playable_url is not null or embed_url is not null or (provider='bunny' and provider_file_id is not null and bunny_library_id is not null))) then raise exception 'Video unavailable'; end if;
  insert into recommendation_events(viewer_hash,video_id,event_type,surface,position,algorithm_version,correlation_id,idempotency_key)
  values(p_viewer,p_video,p_type,p_surface,p_position,p_version,p_correlation,p_idempotency)
  on conflict(viewer_hash,idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end $$;
revoke all on function public.record_recommendation_event(text,uuid,text,text,smallint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_recommendation_event(text,uuid,text,text,smallint,text,uuid,text) to service_role;

create or replace function public.prune_recommendation_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from recommendation_events where created_at < now() - interval '30 days';
  delete from recommendation_feedback where updated_at < now() - interval '180 days';
  delete from recommendation_preferences where consent_expires_at < now();
end $$;
revoke all on function public.prune_recommendation_data() from public, anon, authenticated;
grant execute on function public.prune_recommendation_data() to service_role;

comment on table public.recommendation_preferences is
  'Consent-gated, pseudonymous first-party preference controls. No identity or sensitive-trait inference.';
comment on table public.recommendation_feedback is
  'Explicit recommendation feedback only; separate namespace from anonymous comments and likes.';
comment on table public.recommendation_events is
  'Consent-gated short-retention measurement; no raw IP, user-agent, referrer, or ad data.';
commit;
