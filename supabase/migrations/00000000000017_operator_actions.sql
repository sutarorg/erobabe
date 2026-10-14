begin;
-- Controlled operator transitions; no provider status or settlement override.
create function public.admin_transition(p_admin uuid,p_id uuid,p_action text) returns void language plpgsql security definer set search_path=public as $$
declare c campaigns;
begin
 if not exists(select 1 from profiles where id=p_admin and role='admin' and status='active') then raise exception 'Active admin required'; end if;
 if p_action in ('approve_creative','reject_creative') then
   if not exists(select 1 from ad_creatives where id=p_id and destination_url ~ '^https?://' and image_url ~ '^https://') then raise exception 'Review creative image and destination before approval'; end if;
   update ad_creatives set status=case when p_action='approve_creative' then 'approved' else 'rejected' end,moderated_by=p_admin,moderated_at=now() where id=p_id;
   if p_action='approve_creative' then
     update campaigns c set status='active' where c.creative_id=p_id and c.status='pending_review' and c.end_date>current_date
       and exists(select 1 from payments p where p.id=c.payment_id and p.status='confirmed' and p.advertiser_id=c.advertiser_id)
       and active_advertiser(c.advertiser_id);
   else update campaigns set status='rejected' where creative_id=p_id and status in ('active','pending_review','paused'); end if;
 elsif p_action in ('pause_campaign','resume_campaign','cancel_campaign') then
   select * into c from campaigns where id=p_id for update;
   if not found then raise exception 'Campaign not found'; end if;
   if p_action='resume_campaign' then
     if c.status<>'paused' or c.end_date<=current_date or not active_advertiser(c.advertiser_id)
       or not exists(select 1 from ad_creatives a where a.id=c.creative_id and a.advertiser_id=c.advertiser_id and a.slot_id=c.slot_id and a.status='approved')
       or not exists(select 1 from payments p where p.id=c.payment_id and p.advertiser_id=c.advertiser_id and p.status='confirmed') then raise exception 'Campaign cannot resume'; end if;
   elsif p_action='pause_campaign' and c.status<>'active' then raise exception 'Only active campaigns can pause'; end if;
   update campaigns set status=case p_action when 'pause_campaign' then 'paused' when 'resume_campaign' then 'active' else 'cancelled' end where id=p_id;
 elsif p_action in ('review_report','resolve_report','dismiss_report') then
   update reports set status=case p_action when 'review_report' then 'in_review' when 'resolve_report' then 'resolved' else 'dismissed' end where id=p_id;
 elsif p_action in ('suspend_user','restore_user') then
   if p_id=p_admin or not exists(select 1 from profiles where id=p_id and role='advertiser') then raise exception 'Only other advertiser accounts may be changed'; end if;
   update profiles set status=case when p_action='suspend_user' then 'suspended' else 'active' end where id=p_id;
   update advertiser_profiles set status=case when p_action='suspend_user' then 'suspended' else 'active' end where id=p_id;
 else raise exception 'Unknown operator action'; end if;
 insert into audit_logs(actor_id,action,target_type,target_id,level) values(p_admin,p_action,'operator_transition',p_id::text,'info');
end $$;
revoke all on function public.admin_transition(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_transition(uuid,uuid,text) to service_role;
-- The original migrations never provisioned the advertised creative bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('ad-creatives','ad-creatives',true,10485760,array['image/jpeg','image/png','image/gif'])
 on conflict(id) do update set file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "Active advertisers upload own creatives" on storage.objects for insert to authenticated
 with check(bucket_id='ad-creatives' and split_part(name,'/',1)=auth.uid()::text and public.active_advertiser(auth.uid()));
-- No browser overwrites/deletes, even if a deployment has a broader old policy.
create policy "Protect creative objects from overwrite" on storage.objects as restrictive for update to authenticated using(bucket_id<>'ad-creatives');
create policy "Protect creative objects from deletion" on storage.objects as restrictive for delete to authenticated using(bucket_id<>'ad-creatives');
alter table public.ad_creatives add constraint creative_safe_urls check(destination_url ~ '^https?://' and (image_url is null or image_url ~ '^https://') and length(title) between 1 and 240 and length(destination_url)<=2048 and length(image_url)<=2048) not valid;
commit;
