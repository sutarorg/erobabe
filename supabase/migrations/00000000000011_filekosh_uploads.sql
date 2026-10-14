-- Forward-only: keep all historical provider records and existing RLS intact.
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos add constraint videos_provider_check check
  (provider in ('filekosh','direct_url','streamtape','ufoload','uqload','bunny','cloudflare','internal','s3','embed'));
alter table public.upload_jobs alter column provider set default 'filekosh';
alter table public.videos add column if not exists mime_type text;
alter table public.videos add column if not exists size_bytes bigint;
alter table public.videos add column if not exists provider_share_url text;

-- Presigned URLs live ONLY in a service-role-only recovery table, never public videos.
create table public.filekosh_uploads (
  id uuid primary key,
  created_by uuid not null references public.profiles(id),
  title text not null, original_name text not null, mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0), duration_seconds int,
  category_id uuid references public.categories(id),
  provider_id text unique, provider_slug text, upload_url text, thumbnail_path text,
  confirmation_attempted boolean not null default false,
  state text not null default 'creating' check (state in ('creating','uploading','confirming','completed')),
  video_id uuid references public.videos(id) on delete set null, video_slug text,
  created_at timestamptz not null default now()
);
alter table public.filekosh_uploads enable row level security;
revoke all on public.filekosh_uploads from anon, authenticated;
grant all on public.filekosh_uploads to service_role;
create index filekosh_uploads_owner_idx on public.filekosh_uploads (created_by, created_at desc);

-- Lock + atomic persistence makes concurrent confirmation/retry safe.
create function public.finish_filekosh_upload(p_session uuid, p_admin uuid, p_embed text,
  p_share text, p_thumbnail text, p_duration int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.filekosh_uploads; v_slug text;
begin
  select * into s from public.filekosh_uploads where id = p_session and created_by = p_admin for update;
  if not found then raise exception 'Upload session unavailable'; end if;
  if s.state = 'completed' then return jsonb_build_object('videoId', s.video_id, 'slug', s.video_slug); end if;
  if s.state <> 'confirming' or s.provider_id is null or p_embed is null then raise exception 'Upload not confirmed'; end if;
  v_slug := lower(regexp_replace(s.title, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || s.id;
  insert into public.videos (id, slug, title, category_id, provider, provider_file_id,
    provider_public_id, embed_url, playable_url, provider_share_url, thumbnail_url, mime_type,
    size_bytes, duration_seconds, status, visibility, rights_status, moderation_status,
    published_at, created_by, updated_by)
  values (s.id, v_slug, s.title, s.category_id, 'filekosh', s.provider_id, s.provider_slug,
    p_embed, null, p_share, p_thumbnail, s.mime_type, s.size_bytes, p_duration,
    'published', 'public', 'cleared', 'approved', now(), p_admin, p_admin);
  insert into public.upload_jobs (video_id, file_name, file_size, provider, provider_file_id,
    provider_upload_id, status, progress, created_by)
  values (s.id, s.original_name, s.size_bytes, 'filekosh', s.provider_id, s.id::text, 'completed', 100, p_admin);
  update public.filekosh_uploads set state = 'completed', video_id = s.id, video_slug = v_slug, upload_url = null where id = s.id;
  return jsonb_build_object('videoId', s.id, 'slug', v_slug);
end;
$$;
revoke all on function public.finish_filekosh_upload(uuid, uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.finish_filekosh_upload(uuid, uuid, text, text, text, int) to service_role;
