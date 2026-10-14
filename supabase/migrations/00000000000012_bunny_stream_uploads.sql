-- Forward-only. Historical migrations and retired-provider metadata remain intact.
begin;
alter table public.videos alter column provider set default 'bunny';
alter table public.upload_jobs alter column provider set default 'bunny';
alter table public.videos add column bunny_library_id text;
alter table public.videos add column requires_reupload boolean not null default false;
update public.videos set requires_reupload = true, status = 'unpublished',
  provider_error = 'Archived hosted media: re-upload authorized source files to Bunny Stream.'
where provider in ('filekosh','streamtape','ufoload','uqload');
-- Archive recovery rows, including their metadata; do not drop the table or media IDs.
drop function if exists public.finish_filekosh_upload(uuid, uuid, text, text, text, int);
revoke all on public.filekosh_uploads from service_role;
grant select on public.filekosh_uploads to service_role;
comment on table public.filekosh_uploads is 'Read-only historical recovery archive; no active upload or publishing integration.';

create table public.bunny_uploads (
  id uuid primary key,
  created_by uuid not null references public.profiles(id),
  title text not null check (length(title) between 1 and 240),
  original_name text not null, mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0), duration_seconds int,
  category_id uuid not null references public.categories(id),
  library_id text not null check (library_id ~ '^[1-9][0-9]*$'),
  provider_id uuid, thumbnail_path text,
  provider_status int check (provider_status between 0 and 8), last_error text,
  state text not null default 'creating' check (state in ('creating','uploading','processing','ready','failed','cancelled','completed')),
  video_id uuid references public.videos(id) on delete set null, video_slug text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (library_id, provider_id),
  unique (created_by, original_name, size_bytes, mime_type)
);
alter table public.bunny_uploads enable row level security;
revoke all on public.bunny_uploads from public, anon, authenticated;
grant select, insert, update, delete on public.bunny_uploads to service_role;
create index bunny_uploads_owner_idx on public.bunny_uploads(created_by, created_at desc);
create unique index videos_bunny_identity_idx on public.videos(bunny_library_id, provider_file_id) where provider = 'bunny';

create function public.finish_bunny_upload(p_session uuid, p_admin uuid, p_embed text, p_thumbnail text, p_duration int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.bunny_uploads; v_slug text;
begin
  if not exists (select 1 from public.profiles where id = p_admin and role = 'admin' and status = 'active') then raise exception 'Active administrator required'; end if;
  select * into s from public.bunny_uploads where id = p_session and created_by = p_admin for update;
  if not found then raise exception 'Upload session unavailable'; end if;
  if s.state = 'completed' then return jsonb_build_object('videoId',s.video_id,'slug',s.video_slug); end if;
  if s.state <> 'ready' or s.provider_status is distinct from 4 or s.provider_id is null or s.thumbnail_path is null or p_thumbnail is null
    or p_embed is distinct from 'https://iframe.mediadelivery.net/embed/' || s.library_id || '/' || s.provider_id::text
    or p_duration is null or p_duration < 0 then raise exception 'Upload not confirmed'; end if;
  v_slug := lower(regexp_replace(s.title,'[^a-zA-Z0-9]+','-','g')) || '-' || s.id;
  -- Mirrors existing active-admin publishing rules, with verified readiness/thumbnail prerequisites.
  insert into public.videos (id,slug,title,category_id,provider,provider_file_id,bunny_library_id,
    embed_url,playable_url,thumbnail_url,mime_type,size_bytes,duration_seconds,status,visibility,
    rights_status,moderation_status,published_at,created_by,updated_by)
  values (s.id,v_slug,s.title,s.category_id,'bunny',s.provider_id::text,s.library_id,p_embed,null,
    p_thumbnail,s.mime_type,s.size_bytes,p_duration,'published','public','cleared','approved',now(),p_admin,p_admin);
  insert into public.upload_jobs(video_id,file_name,file_size,provider,provider_file_id,provider_upload_id,status,progress,created_by)
  values(s.id,s.original_name,s.size_bytes,'bunny',s.provider_id::text,s.id::text,'completed',100,p_admin);
  update public.bunny_uploads set state='completed',video_id=s.id,video_slug=v_slug,updated_at=now() where id=s.id;
  return jsonb_build_object('videoId',s.id,'slug',v_slug);
end;
$$;
revoke all on function public.finish_bunny_upload(uuid,uuid,text,text,int) from public,anon,authenticated;
grant execute on function public.finish_bunny_upload(uuid,uuid,text,text,int) to service_role;
-- Retired records may be edited, never created or republished. Keep their original IDs and URLs.
create function public.guard_archived_video() returns trigger language plpgsql set search_path = public as $$
begin
  if new.provider in ('filekosh','streamtape','ufoload','uqload') then
    if TG_OP = 'INSERT' then raise exception 'Use Bunny Stream for new hosted videos'; end if;
    new.requires_reupload := true;
    if new.status = 'published' then raise exception 'Re-upload this archived source to Bunny Stream'; end if;
  end if;
  return new;
end;
$$;
create trigger guard_archived_video before insert or update on public.videos for each row execute function public.guard_archived_video();
commit;
