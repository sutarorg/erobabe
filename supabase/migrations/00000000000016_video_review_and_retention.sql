-- Provider readiness is not a rights/moderation decision. Existing publications are unchanged.
begin;
create or replace function public.stage_bunny_upload(
  p_session uuid,
  p_admin uuid,
  p_embed text,
  p_thumbnail_path text,
  p_thumbnail text,
  p_provider_status int,
  p_progress int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.bunny_uploads;
  v_slug text;
  v_provider_status text;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_admin and role = 'admin' and status = 'active'
  ) then raise exception 'Active administrator required'; end if;

  select * into s from public.bunny_uploads where id = p_session for update;
  if not found then raise exception 'Upload session unavailable'; end if;
  if s.state = 'completed' then
    return jsonb_build_object('videoId', s.video_id, 'slug', s.video_slug, 'state', 'completed');
  end if;
  if s.state = 'cancelled' then raise exception 'Upload session was cancelled'; end if;
  if s.provider_id is null or p_thumbnail_path is null or p_thumbnail is null
    or p_embed is distinct from 'https://iframe.mediadelivery.net/embed/' || s.library_id || '/' || s.provider_id::text
    or p_provider_status not between 0 and 8 or p_provider_status in (4, 5, 6)
    or p_progress not between 0 and 100 then
    raise exception 'Upload not ready to stage';
  end if;

  v_provider_status := case p_provider_status
    when 0 then 'Created'
    when 1 then 'Uploaded'
    when 2 then 'Processing'
    when 3 then 'Transcoding'
    when 7 then 'JitSegmenting'
    when 8 then 'JitPlaylistsCreated'
    else 'Processing'
  end;
  v_slug := coalesce(
    nullif(trim(both '-' from lower(regexp_replace(s.title, '[^a-zA-Z0-9]+', '-', 'g'))), ''),
    'video'
  ) || '-' || s.id::text;

  insert into public.videos (
    id, slug, title, category_id, provider, provider_file_id, bunny_library_id,
    embed_url, playable_url, thumbnail_url, mime_type, size_bytes, duration_seconds,
    status, visibility, rights_status, moderation_status, published_at,
    provider_progress, provider_error, created_by, updated_by
  ) values (
    s.id, v_slug, s.title, s.category_id, 'bunny', s.provider_id::text, s.library_id,
    p_embed, null, p_thumbnail, s.mime_type, s.size_bytes, s.duration_seconds,
    'processing', 'private', 'pending', 'pending', null,
    least(99, p_progress), null, s.created_by, s.created_by
  )
  on conflict (id) do update set
    title = excluded.title,
    category_id = excluded.category_id,
    embed_url = excluded.embed_url,
    thumbnail_url = excluded.thumbnail_url,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    duration_seconds = coalesce(public.videos.duration_seconds, excluded.duration_seconds),
    status = 'processing',
    visibility = 'private',
    rights_status = 'pending',
    moderation_status = 'pending',
    provider_progress = least(99, p_progress),
    provider_error = null,
    updated_by = s.created_by,
    updated_at = now()
  where public.videos.provider = 'bunny'
    and public.videos.provider_file_id = s.provider_id::text
    and public.videos.bunny_library_id = s.library_id
  returning slug into v_slug;
  if v_slug is null then raise exception 'Bunny video identity conflict'; end if;

  update public.upload_jobs set
    video_id = s.id,
    file_name = s.original_name,
    file_size = s.size_bytes,
    provider = 'bunny',
    provider_file_id = s.provider_id::text,
    status = 'processing',
    progress = least(99, p_progress),
    provider_status = v_provider_status,
    error_message = null,
    created_by = s.created_by,
    updated_at = now()
  where provider_upload_id = s.id::text;
  if not found then
    insert into public.upload_jobs (
      video_id, file_name, file_size, provider, provider_file_id,
      provider_upload_id, provider_status, status, progress, created_by
    ) values (
      s.id, s.original_name, s.size_bytes, 'bunny', s.provider_id::text,
      s.id::text, v_provider_status, 'processing', least(99, p_progress), s.created_by
    );
  end if;

  update public.bunny_uploads set
    state = 'processing',
    provider_status = p_provider_status,
    thumbnail_path = p_thumbnail_path,
    last_error = null,
    updated_at = now()
  where id = s.id;

  return jsonb_build_object('videoId', s.id, 'slug', v_slug, 'state', 'processing');
end;
$$;

create or replace function public.finish_bunny_upload(
  p_session uuid,
  p_admin uuid,
  p_embed text,
  p_thumbnail text,
  p_duration int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.bunny_uploads;
  v_slug text;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_admin and role = 'admin' and status = 'active'
  ) then raise exception 'Active administrator required'; end if;

  select * into s from public.bunny_uploads where id = p_session for update;
  if not found then raise exception 'Upload session unavailable'; end if;
  if s.state = 'completed' then
    return jsonb_build_object('videoId', s.video_id, 'slug', s.video_slug);
  end if;
  if s.state <> 'ready' or s.provider_status is distinct from 4
    or s.provider_id is null or s.thumbnail_path is null or p_thumbnail is null
    or p_embed is distinct from 'https://iframe.mediadelivery.net/embed/' || s.library_id || '/' || s.provider_id::text
    or p_duration is null or p_duration < 0 then
    raise exception 'Upload not confirmed';
  end if;

  v_slug := coalesce(
    nullif(trim(both '-' from lower(regexp_replace(s.title, '[^a-zA-Z0-9]+', '-', 'g'))), ''),
    'video'
  ) || '-' || s.id::text;
  insert into public.videos (
    id, slug, title, category_id, provider, provider_file_id, bunny_library_id,
    embed_url, playable_url, thumbnail_url, mime_type, size_bytes, duration_seconds,
    status, visibility, rights_status, moderation_status, published_at,
    provider_progress, provider_error, created_by, updated_by
  ) values (
    s.id, v_slug, s.title, s.category_id, 'bunny', s.provider_id::text, s.library_id,
    p_embed, null, p_thumbnail, s.mime_type, s.size_bytes, p_duration,
    'pending_review', 'private', 'pending', 'pending', null,
    100, null, s.created_by, s.created_by
  )
  on conflict (id) do update set
    title = excluded.title,
    category_id = excluded.category_id,
    embed_url = excluded.embed_url,
    playable_url = null,
    thumbnail_url = excluded.thumbnail_url,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    duration_seconds = excluded.duration_seconds,
    status = 'pending_review',
    visibility = 'private',
    rights_status = 'pending',
    moderation_status = 'pending',
    published_at = null,
    provider_progress = 100,
    provider_error = null,
    updated_by = s.created_by,
    updated_at = now()
  where public.videos.provider = 'bunny'
    and public.videos.provider_file_id = s.provider_id::text
    and public.videos.bunny_library_id = s.library_id
  returning slug into v_slug;
  if v_slug is null then raise exception 'Bunny video identity conflict'; end if;

  update public.upload_jobs set
    video_id = s.id,
    file_name = s.original_name,
    file_size = s.size_bytes,
    provider = 'bunny',
    provider_file_id = s.provider_id::text,
    status = 'completed',
    progress = 100,
    provider_status = 'Finished',
    error_message = null,
    created_by = s.created_by,
    updated_at = now()
  where provider_upload_id = s.id::text;
  if not found then
    insert into public.upload_jobs (
      video_id, file_name, file_size, provider, provider_file_id,
      provider_upload_id, provider_status, status, progress, created_by
    ) values (
      s.id, s.original_name, s.size_bytes, 'bunny', s.provider_id::text,
      s.id::text, 'Finished', 'completed', 100, s.created_by
    );
  end if;

  update public.bunny_uploads set
    state = 'completed', video_id = s.id, video_slug = v_slug,
    provider_status = 4, last_error = null, updated_at = now()
  where id = s.id;
  return jsonb_build_object('videoId', s.id, 'slug', v_slug);
end;
$$;


create function public.publish_reviewed_bunny(p_video uuid,p_admin uuid,p_ownership text,p_evidence text) returns void language plpgsql security definer set search_path=public as $$
declare v videos;
begin
 if not is_admin() and not exists(select 1 from profiles where id=p_admin and role='admin' and status='active') then raise exception 'Active admin required'; end if;
 if p_ownership not in ('owned','licensed','partner') or length(trim(p_evidence)) not between 20 and 2000 then raise exception 'Rights and moderation evidence required'; end if;
 select * into v from videos where id=p_video for update;
 if not found or v.provider<>'bunny' or v.requires_reupload or v.status not in ('pending_review','unpublished')
 or v.thumbnail_url is null or v.category_id is null or v.title='' or not exists(select 1 from bunny_uploads b where b.video_id=v.id and b.state='completed' and b.provider_status=4) then raise exception 'Video not eligible for publication'; end if;
 insert into rights_records(video_id,ownership_type,license_info,distribution_permissions,review_history,created_by)
 values(v.id,p_ownership,p_evidence,'Explicit admin publication review',jsonb_build_array(jsonb_build_object('admin',p_admin,'at',now(),'decision','approved')),p_admin);
 update videos set rights_status='cleared',moderation_status='approved',visibility='public',status='published',published_at=now(),updated_by=p_admin where id=v.id;
 insert into audit_logs(actor_id,action,target_type,target_id,level) values(p_admin,'video_reviewed_and_published','video',v.id::text,'info');
end $$;
revoke all on function public.publish_reviewed_bunny(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.publish_reviewed_bunny(uuid,uuid,text,text) to service_role;
-- Catalog deletion deliberately retains provider bytes, with durable identity.
create table public.media_retention(
 id uuid primary key default gen_random_uuid(), video_id uuid not null, provider text not null,
 provider_file_id text, library_id text, reason text not null default 'Catalog deleted; remote media retained pending operator review',
 status text not null default 'pending_review' check(status in ('pending_review','retained','deleted')),
 created_at timestamptz not null default now(), reviewed_at timestamptz
);
alter table public.media_retention enable row level security;
grant all on public.media_retention to service_role;
grant select on public.media_retention to authenticated;
create policy "Admin reads retained media" on public.media_retention for select to authenticated using(is_admin());
create function public.retain_deleted_media() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if old.provider_file_id is not null then insert into media_retention(video_id,provider,provider_file_id,library_id) values(old.id,old.provider,old.provider_file_id,old.bunny_library_id); end if;
 return old;
end $$;
create trigger retain_deleted_media before delete on public.videos for each row execute function public.retain_deleted_media();
commit;
