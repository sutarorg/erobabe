-- Keep the video catalog visible while Bunny performs its asynchronous encode.
-- TUS transfers still go directly from the browser to Bunny; this migration
-- only stages an admin-private catalog row and finalizes it after status 4.
begin;

create index if not exists videos_bunny_processing_idx
  on public.videos (created_at desc)
  where provider = 'bunny' and status = 'processing';

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
    'processing', 'private', 'cleared', 'approved', null,
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
    rights_status = 'cleared',
    moderation_status = 'approved',
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
    or s.provider_id is null or p_thumbnail is null
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
    'published', 'public', 'cleared', 'approved', now(),
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
    status = 'published',
    visibility = 'public',
    rights_status = 'cleared',
    moderation_status = 'approved',
    published_at = coalesce(public.videos.published_at, now()),
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

create or replace function public.fail_bunny_upload(
  p_session uuid,
  p_admin uuid,
  p_provider_status int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.bunny_uploads;
  v_message text;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_admin and role = 'admin' and status = 'active'
  ) then raise exception 'Active administrator required'; end if;
  if p_provider_status not in (5, 6) then raise exception 'Invalid Bunny failure status'; end if;

  select * into s from public.bunny_uploads where id = p_session for update;
  if not found then raise exception 'Upload session unavailable'; end if;
  if s.state = 'completed' then
    return jsonb_build_object('videoId', s.video_id, 'slug', s.video_slug, 'state', 'completed');
  end if;

  v_message := case p_provider_status when 5 then 'Bunny Error' else 'Bunny UploadFailed' end;
  update public.bunny_uploads set
    state = 'failed', provider_status = p_provider_status,
    last_error = v_message, updated_at = now()
  where id = s.id;
  update public.videos set
    status = 'unpublished', visibility = 'private', provider_progress = 0,
    provider_error = v_message, updated_by = s.created_by, updated_at = now()
  where id = s.id and provider = 'bunny' and provider_file_id = s.provider_id::text;
  update public.upload_jobs set
    status = 'failed', progress = 0, provider_status = v_message,
    error_message = v_message, updated_at = now()
  where provider_upload_id = s.id::text;

  return jsonb_build_object('videoId', s.id, 'state', 'failed', 'error', v_message);
end;
$$;

revoke all on function public.stage_bunny_upload(uuid, uuid, text, text, text, int, int) from public, anon, authenticated;
revoke all on function public.finish_bunny_upload(uuid, uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.fail_bunny_upload(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.stage_bunny_upload(uuid, uuid, text, text, text, int, int) to service_role;
grant execute on function public.finish_bunny_upload(uuid, uuid, text, text, int) to service_role;
grant execute on function public.fail_bunny_upload(uuid, uuid, int) to service_role;

comment on function public.stage_bunny_upload(uuid, uuid, text, text, text, int, int) is
  'Creates or refreshes a private processing catalog row as soon as a Bunny upload is accepted; no provider encoding wait.';
comment on function public.finish_bunny_upload(uuid, uuid, text, text, int) is
  'Publishes the staged Bunny catalog row only after provider status 4 (Finished) and a stored thumbnail are verified.';
commit;
