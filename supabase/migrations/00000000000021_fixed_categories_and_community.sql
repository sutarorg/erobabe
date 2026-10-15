begin;
-- Existing matching categories keep their IDs, thumbnails and video associations.
insert into public.categories(label, slug, icon, description) values
  ('Amateur', 'amateur', 'camera', 'Independent creators and authentic productions.'),
  ('Lesbian', 'lesbian', 'heart', 'Discover productions featuring adult women.'),
  ('MILF', 'milf', 'wine', 'Confident mature adult performers.'),
  ('Japanese', 'japanese', 'flower', 'Discover Japanese adult productions.'),
  ('Teen (18+)', 'teen-18plus', 'sparkles', 'Young adult performers aged 18 and over only.'),
  ('Hentai', 'hentai', 'drama', 'Animated fantasy featuring adult characters only.'),
  ('Ebony', 'ebony', 'user', 'Discover Black adult performers and creators.'),
  ('POV', 'pov', 'eye', 'First-person camera perspectives.'),
  ('Big Ass', 'big-ass', 'flame', 'Curvy adult performer collections.'),
  ('Threesome', 'threesome', 'users', 'Productions featuring three adult performers.'),
  ('Hardcore', 'hardcore', 'mask', 'Explicit adult productions.'),
  ('Massage', 'massage', 'flower', 'Relaxation and massage-themed productions.')
on conflict (slug) do update set label=excluded.label, icon=excluded.icon,
 description=coalesce(public.categories.description, excluded.description);
-- Upload recovery rows also reference categories. Preserve those rows rather
-- than failing the migration or deleting provider history. Active sessions for
-- retired categories are stopped until the administrator chooses a new category.
alter table public.bunny_uploads alter column category_id drop not null;
alter table public.bunny_uploads drop constraint bunny_uploads_category_id_fkey;
alter table public.bunny_uploads add constraint bunny_uploads_category_id_fkey
 foreign key(category_id) references public.categories(id) on delete set null;
alter table public.filekosh_uploads drop constraint filekosh_uploads_category_id_fkey;
alter table public.filekosh_uploads add constraint filekosh_uploads_category_id_fkey
 foreign key(category_id) references public.categories(id) on delete set null;
update public.bunny_uploads set state='cancelled', last_error='Category retired; select a current category and restart the upload.'
where state not in ('completed','cancelled') and category_id in (
 select id from public.categories where slug not in ('amateur','lesbian','milf','japanese','teen-18plus','hentai','ebony','pov','big-ass','threesome','hardcore','massage')
);
-- Retired categories are removed; their videos remain, uncategorized, for admin review.
delete from public.categories where slug not in ('amateur','lesbian','milf','japanese','teen-18plus','hentai','ebony','pov','big-ass','threesome','hardcore','massage');
create function public.lock_category_taxonomy() returns trigger language plpgsql as $$
begin
  if TG_OP <> 'UPDATE' then raise exception 'Category inventory is fixed'; end if;
  if NEW.id <> OLD.id or NEW.label <> OLD.label or NEW.slug <> OLD.slug or NEW.icon is distinct from OLD.icon then
    raise exception 'Category identity and icons are fixed';
  end if;
  return NEW;
end; $$;
create trigger fixed_category_taxonomy before insert or update or delete on public.categories
for each row execute function public.lock_category_taxonomy();

create table public.video_comments (
 id uuid primary key default gen_random_uuid(),
 video_id uuid not null references public.videos(id) on delete cascade,
 profile_name text not null check (char_length(profile_name) between 3 and 60),
 body text not null check (char_length(trim(body)) between 1 and 1000),
 visitor_hash text not null,
 created_at timestamptz not null default now()
);
create index video_comments_page on public.video_comments(video_id, created_at desc, id desc);
alter table public.video_comments enable row level security;
-- Only server endpoints may access comments (including visitor hashes).
revoke all on public.video_comments from anon, authenticated;
grant all on public.video_comments to service_role;
create function public.post_video_comment(p_video uuid, p_name text, p_body text, p_visitor text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_visitor, 0));
 if exists(select 1 from video_comments where visitor_hash=p_visitor and created_at > now()-interval '30 seconds') then
   raise exception 'Please wait 30 seconds between comments' using errcode='P0001';
 end if;
 if not exists(select 1 from videos where id=p_video and status='published' and visibility='public'
   and rights_status='cleared' and moderation_status='approved' and not requires_reupload) then
   raise exception 'Video unavailable';
 end if;
 insert into video_comments(video_id,profile_name,body,visitor_hash) values(p_video,p_name,trim(p_body),p_visitor) returning id into result;
 return result;
end; $$;
revoke all on function public.post_video_comment(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.post_video_comment(uuid,text,text,text) to service_role;

alter table public.videos add column like_count bigint not null default 0;
create table public.video_likes (
 video_id uuid not null references public.videos(id) on delete cascade,
 visitor_hash text not null,
 primary key(video_id,visitor_hash)
);
alter table public.video_likes enable row level security;
revoke all on public.video_likes from anon, authenticated;
create function public.set_video_like(p_video uuid, p_visitor text, p_liked boolean)
returns void language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 perform 1 from videos where id=p_video and status='published' and visibility='public'
 and rights_status='cleared' and moderation_status='approved' and not requires_reupload for update;
 if not found then raise exception 'Video unavailable'; end if;
 if p_liked then
   insert into video_likes values(p_video,p_visitor) on conflict do nothing;
   get diagnostics changed = row_count;
   update videos set like_count=like_count+changed where id=p_video;
 else
   delete from video_likes where video_id=p_video and visitor_hash=p_visitor;
   get diagnostics changed = row_count;
   update videos set like_count=greatest(0,like_count-changed) where id=p_video;
 end if;
end; $$;
revoke all on function public.set_video_like(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.set_video_like(uuid,text,boolean) to service_role;
create index video_comments_rate_limit on public.video_comments(visitor_hash, created_at desc);
create index videos_watch_latest on public.videos(published_at desc, id desc)
where status='published' and visibility='public' and rights_status='cleared' and moderation_status='approved' and not requires_reupload;
-- API roles cannot bypass the fixed inventory with TRUNCATE.
revoke insert, delete, truncate on public.categories from anon, authenticated;

commit;
