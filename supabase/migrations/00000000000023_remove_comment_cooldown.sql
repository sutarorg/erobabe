begin;

-- Remove cooldown from comment posting RPC
create or replace function public.post_video_comment(p_video uuid, p_name text, p_body text, p_visitor text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 if not exists(select 1 from videos where id=p_video and status='published' and visibility='public'
   and rights_status='cleared' and moderation_status='approved' and not requires_reupload) then
   raise exception 'Video unavailable';
 end if;
 insert into video_comments(video_id,profile_name,body,visitor_hash) values(p_video,p_name,trim(p_body),p_visitor) returning id into result;
 return result;
end; $$;

revoke all on function public.post_video_comment(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.post_video_comment(uuid,text,text,text) to service_role;

commit;
