-- Retire hosted uploads (Bunny Stream) and make damplips.com the catalog source.
--
-- Everything an administrator uploads is gone: no upload sessions, no encoding
-- polling, no provider credential columns. The catalog is now filled by the
-- damplips importer, which stores an external embed/direct media URL plus the
-- page it came from, and never copies bytes into this project.
--
-- Forward-only: historical migrations stay untouched; this migration drops the
-- upload pipeline objects and the columns only that pipeline read.
begin;

-- 1. Upload pipeline: sessions, guarded publication and encoding polls.
drop function if exists public.finish_bunny_upload(uuid, uuid, text, text, int);
drop function if exists public.stage_bunny_upload(uuid, uuid, text, text, text, int, int);
drop function if exists public.fail_bunny_upload(uuid, uuid, int);
drop function if exists public.publish_reviewed_bunny(uuid, uuid, text, text);
drop table if exists public.bunny_uploads;
drop index if exists public.videos_bunny_identity_idx;
drop index if exists public.videos_bunny_processing_idx;

-- Retired uploads for other providers are dead weight too; the media identity
-- they hold is preserved in media_retention where it matters.
drop table if exists public.filekosh_uploads;

-- Upload job tracking has no producer once uploads are removed.
drop table if exists public.upload_jobs;

-- The archived-provider guard existed only to force re-uploads into Bunny.
drop trigger if exists guard_archived_video on public.videos;
drop function if exists public.guard_archived_video();

-- 2. The retention trigger referenced the Bunny library column; rewrite it
--    before the column disappears.
create or replace function public.retain_deleted_media()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.provider_file_id is not null then
    insert into public.media_retention(video_id, provider, provider_file_id, reason)
    values (
      old.id,
      old.provider,
      old.provider_file_id,
      'Catalog deleted; external media reference retained for operator review'
    );
  end if;
  return old;
end $$;

alter table public.videos drop column if exists bunny_library_id;

-- 3. Providers: damplips becomes the default; historical values stay valid so
--    existing rows are never rewritten or rejected by the check constraint.
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos add constraint videos_provider_check
  check (provider in (
    'damplips',
    'direct_url',
    'embed',
    'internal',
    's3',
    'cloudflare',
    'bunny',
    'uqload',
    'filekosh',
    'streamtape',
    'ufoload'
  ));
alter table public.videos alter column provider set default 'damplips';

-- 4. Source attribution for embedded catalog entries. `provider_file_id` holds
--    the damplips post id, `source_url` the page an embed is credited to.
alter table public.videos add column if not exists source_name text;
alter table public.videos add column if not exists source_url text;
update public.videos set source_name = 'damplips'
  where provider = 'damplips' and source_name is null;

create unique index if not exists videos_damplips_identity_idx
  on public.videos (provider, provider_file_id)
  where provider = 'damplips' and provider_file_id is not null;

create index if not exists videos_damplips_category_idx
  on public.videos (category_id, published_at desc)
  where provider = 'damplips';

-- 5. Operator view: how much of each fixed category is actually filled.
create or replace view public.damplips_category_counts as
select
  c.id as category_id,
  c.label,
  c.slug,
  count(v.id) filter (
    where v.status = 'published'
      and v.visibility = 'public'
      and v.requires_reupload = false
      and not (v.playable_url is null and v.embed_url is null)
  )::int as published_count
from public.categories c
left join public.videos v
  on v.category_id = c.id
 and v.provider = 'damplips'
group by c.id, c.label, c.slug
order by c.label;

revoke all on public.damplips_category_counts from public, anon, authenticated;
grant select on public.damplips_category_counts to service_role;
grant select on public.damplips_category_counts to authenticated;

comment on view public.damplips_category_counts is
  'Per fixed category: published damplips embeds with a playable destination. Used to verify the 100-per-category target.';

-- 6. Recommendation writes read `bunny_library_id` in their eligibility check.
--    That column is gone, so the three trusted functions are recreated against
--    the one predicate every public surface now uses: a published, public,
--    cleared, approved row with a real playback destination. Feedback writes now
--    also require an active consent record for the viewer.
create or replace function public.set_recommendation_feedback(p_viewer text, p_video uuid, p_feedback text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_feedback not in ('interested','not_interested','show_less') then raise exception 'Invalid feedback'; end if;
  if not exists(
    select 1 from public.recommendation_preferences
    where viewer_hash = p_viewer and consent_expires_at > now()
  ) then
    raise exception 'Consent required for recommendation feedback';
  end if;
  if not exists(
    select 1 from public.videos
    where id = p_video
      and status = 'published'
      and visibility = 'public'
      and rights_status = 'cleared'
      and moderation_status = 'approved'
      and not requires_reupload
      and (playable_url is not null or embed_url is not null)
  ) then
    raise exception 'Video unavailable';
  end if;
  insert into public.recommendation_feedback(viewer_hash, video_id, feedback, updated_at)
  values (p_viewer, p_video, p_feedback, now())
  on conflict (viewer_hash, video_id) do update set feedback = excluded.feedback, updated_at = now();
end $$;
revoke all on function public.set_recommendation_feedback(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_recommendation_feedback(text, uuid, text) to service_role;

create or replace function public.suppress_recommendation_category(p_viewer text, p_video uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_category uuid;
begin
  if not exists(
    select 1 from public.recommendation_preferences
    where viewer_hash = p_viewer and consent_expires_at > now()
  ) then
    raise exception 'Consent required for recommendation feedback';
  end if;
  select category_id into v_category
  from public.videos
  where id = p_video
    and status = 'published'
    and visibility = 'public'
    and rights_status = 'cleared'
    and moderation_status = 'approved'
    and not requires_reupload
    and (playable_url is not null or embed_url is not null);
  if not found or v_category is null then raise exception 'Video unavailable'; end if;
  update public.recommendation_preferences
  set suppressed_category_ids = array(select distinct unnest(suppressed_category_ids || v_category)),
      updated_at = now(),
      consent_expires_at = now() + interval '180 days'
  where viewer_hash = p_viewer;
end $$;
revoke all on function public.suppress_recommendation_category(text, uuid) from public, anon, authenticated;
grant execute on function public.suppress_recommendation_category(text, uuid) to service_role;

create or replace function public.record_recommendation_event(
  p_viewer text, p_video uuid, p_type text, p_surface text, p_position smallint,
  p_version text, p_correlation uuid, p_idempotency text
) returns boolean language plpgsql security definer set search_path = public as $$
declare inserted_count integer;
begin
  if not exists(
    select 1 from public.videos
    where id = p_video
      and status = 'published'
      and visibility = 'public'
      and rights_status = 'cleared'
      and moderation_status = 'approved'
      and not requires_reupload
      and (playable_url is not null or embed_url is not null)
  ) then
    raise exception 'Video unavailable';
  end if;
  insert into public.recommendation_events(viewer_hash, video_id, event_type, surface, position, algorithm_version, correlation_id, idempotency_key)
  values (p_viewer, p_video, p_type, p_surface, p_position, p_version, p_correlation, p_idempotency)
  on conflict (viewer_hash, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end $$;
revoke all on function public.record_recommendation_event(text, uuid, text, text, smallint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_recommendation_event(text, uuid, text, text, smallint, text, uuid, text) to service_role;

comment on function public.set_recommendation_feedback(text, uuid, text) is
  'Trusted feedback write: requires an active consent record and a published video with a playback destination.';

commit;
