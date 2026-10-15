-- Forward-only. Back up and reconcile existing overlapping campaigns before rollout.
begin;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='active')
$$;
create or replace function public.active_advertiser(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p join advertiser_profiles a on a.id=p.id where p.id=p_id and p.role='advertiser' and p.status='active' and a.status='active')
$$;
do $$ declare t text; begin
 foreach t in array array['profiles','advertiser_profiles','campaigns','ad_creatives','payments','invoices','campaign_reservations','support_tickets','notifications'] loop
   execute format('create policy "Active account required" on public.%I as restrictive for all to authenticated using (public.is_admin() or public.active_advertiser(auth.uid())) with check (public.is_admin() or public.active_advertiser(auth.uid()))',t);
 end loop;
end $$;
-- Do not expose raw provider payloads, settlement evidence or legacy responses.
revoke select on public.payments from authenticated;
grant select(id,advertiser_id,invoice_number,amount_cents,currency,payment_currency,chain,payment_address,expected_amount,transaction_id,status,confirmed_at,expires_at,created_at,updated_at,provider,provider_payment_id,provider_status,pay_currency) on public.payments to authenticated;
-- Browser writes cannot create settlement evidence or change account status.
drop policy "Authenticated can insert own payment" on public.payments;
drop policy "Authenticated can insert own advertiser_profile" on public.advertiser_profiles;
revoke update on public.advertiser_profiles from authenticated;
grant update(company_name,contact_name,website,country) on public.advertiser_profiles to authenticated;
drop policy "Advertiser can manage own reservations" on public.campaign_reservations;
drop policy "Advertiser can manage own campaigns" on public.campaigns;
create policy "Active advertiser reads campaigns" on public.campaigns for select to authenticated using(advertiser_id=auth.uid() and public.active_advertiser(auth.uid()));
create policy "Active advertiser creates pending campaign" on public.campaigns for insert to authenticated with check(advertiser_id=auth.uid() and public.active_advertiser(auth.uid()));
create policy "Active advertiser deletes unattached campaign" on public.campaigns for delete to authenticated using(advertiser_id=auth.uid() and payment_id is null and status='pending_payment' and public.active_advertiser(auth.uid()));
drop policy "Advertiser can manage own creatives" on public.ad_creatives;
create policy "Active advertiser reads creatives" on public.ad_creatives for select to authenticated using(advertiser_id=auth.uid() and public.active_advertiser(auth.uid()));
create policy "Active advertiser submits creative" on public.ad_creatives for insert to authenticated with check(advertiser_id=auth.uid() and public.active_advertiser(auth.uid()) and status='pending' and moderation_notes is null and moderated_by is null and moderated_at is null);
create policy "Active advertiser deletes unused creative" on public.ad_creatives for delete to authenticated using(advertiser_id=auth.uid() and status='pending' and public.active_advertiser(auth.uid()) and not exists(select 1 from public.campaigns c where c.creative_id=ad_creatives.id));

alter table public.campaigns add column hold_expires_at timestamptz default (now()+interval '1 hour');
create function public.guard_campaign() returns trigger language plpgsql security definer set search_path=public as $$
declare v_price integer; v_days integer;
begin
 -- Lock the physical inventory row: every overlapping insert/update serializes.
 -- Touching the locked row also makes repeatable-read contenders serialize
 -- or fail with a serialization error rather than reading an old snapshot.
 update public.ad_slots set updated_at=clock_timestamp() where id=new.slot_id;
 if current_setting('role') in ('authenticated','anon') and not public.is_admin() then
   if TG_OP <> 'INSERT' or not public.active_advertiser(auth.uid()) or new.advertiser_id<>auth.uid()
     or new.status<>'pending_payment' or new.payment_id is not null or new.invoice_id is not null
     or new.impressions<>0 or new.clicks<>0 or new.progress<>0 then raise exception 'Protected campaign state'; end if;
   v_days := new.end_date-new.start_date;
   if new.start_date<>current_date or v_days<30 or v_days>360 or v_days%30<>0 then raise exception 'Invalid campaign dates'; end if;
   if not exists(select 1 from ad_creatives where id=new.creative_id and advertiser_id=new.advertiser_id and slot_id=new.slot_id and status='pending') then raise exception 'Invalid creative'; end if;
   select price_cents into v_price from ad_slots where id=new.slot_id and status='available';
   if v_price is null then raise exception 'Slot unavailable'; end if;
   new.price_cents := v_price*(v_days/30);
   new.hold_expires_at := now()+interval '1 hour';
 end if;
 if new.status in ('pending_payment','pending_review','active','paused') then
   if exists(select 1 from campaigns c where c.id<>new.id and c.slot_id=new.slot_id
     and c.status in ('pending_payment','pending_review','active','paused')
     and (c.status<>'pending_payment' or c.hold_expires_at>now())
     and daterange(c.start_date,c.end_date,'[)') && daterange(new.start_date,new.end_date,'[)')) then
     raise exception 'Slot already reserved' using errcode='23P01';
   end if;
 end if;
 return new;
end $$;
create trigger guard_campaign before insert or update on public.campaigns for each row execute function public.guard_campaign();

-- Claim all campaigns and invoice BEFORE asking the provider for an address.
create function public.claim_checkout(p_payment uuid,p_campaigns uuid[],p_advertiser uuid,p_months integer) returns void language plpgsql security definer set search_path=public as $$
declare p payments; c campaigns; total integer:=0; n integer:=0; invoice uuid;
begin
 select * into p from payments where id=p_payment for update;
 if not found or p.advertiser_id<>p_advertiser or p.status<>'pending' or not active_advertiser(p_advertiser) then raise exception 'Checkout unavailable'; end if;
 if p_months not between 1 and 12 or cardinality(p_campaigns) not between 1 and 10 then raise exception 'Invalid checkout'; end if;
 perform 1 from ad_slots where id in(select slot_id from campaigns where id=any(p_campaigns)) order by id for update;
 for c in select * from campaigns where id=any(p_campaigns) order by slot_id for update loop
   if c.advertiser_id<>p_advertiser or c.payment_id is not null or c.status<>'pending_payment' or c.hold_expires_at<=now()
      or c.end_date-c.start_date<>p_months*30 or not exists(select 1 from ad_slots where id=c.slot_id and status='available') then raise exception 'Campaign unavailable'; end if;
   total:=total+(select price_cents*p_months from ad_slots where id=c.slot_id); n:=n+1;
 end loop;
 if n<>cardinality(p_campaigns) or total<>p.amount_cents then raise exception 'Checkout price changed'; end if;
 insert into invoices(number,advertiser_id,payment_id,amount_cents,status,description) values(p.invoice_number,p_advertiser,p.id,total,'pending','Advertising placement reservation') returning id into invoice;
 update campaigns set payment_id=p.id,invoice_id=invoice where id=any(p_campaigns);
end $$;
revoke all on function public.claim_checkout(uuid,uuid[],uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_checkout(uuid,uuid[],uuid,integer) to service_role;

-- One transaction for settlement and all side effects. Retries repair atomically.
create function public.settle_nowpayment(p_payment uuid,p_provider text,p_status text,p_evidence jsonb) returns void language plpgsql security definer set search_path=public as $$
declare p payments;
begin
 select * into p from payments where id=p_payment for update;
 if not found or p.provider<>'nowpayments' or p.provider_payment_id is distinct from p_provider then raise exception 'Payment identity mismatch'; end if;
 if p.status='refunded' or (p.status='confirmed' and p_status<>'refunded') then return; end if;
 if p.status in ('failed','expired') then return; end if;
 if p_status not in ('confirmed','failed','expired','refunded','underpaid','overpaid') then raise exception 'Invalid settlement'; end if;
 if p_status='confirmed' and (p_evidence->>'amount_verified') is distinct from 'true' then raise exception 'Verification required'; end if;
 update payments set status=p_status,provider_response=p_evidence,provider_status=p_evidence->>'provider_status',confirmed_at=case when p_status='confirmed' then now() else confirmed_at end where id=p.id;
 update invoices set status=case when p_status='confirmed' then 'paid' when p_status in ('underpaid','overpaid') then 'pending' else p_status end,paid_at=case when p_status='confirmed' then now() else paid_at end where payment_id=p.id;
 if p_status='confirmed' then
   update campaigns c set status=case when hold_expires_at<=now() or end_date<=current_date then 'cancelled' when exists(select 1 from ad_creatives a where a.id=c.creative_id and a.advertiser_id=c.advertiser_id and a.slot_id=c.slot_id and a.status='approved') then 'active' else 'pending_review' end
   where payment_id=p.id and status='pending_payment';
 elsif p_status in ('failed','expired') then
   update campaigns set status='cancelled' where payment_id=p.id and status='pending_payment';
 elsif p_status in ('refunded','underpaid','overpaid') then
   update campaigns set status='paused' where payment_id=p.id and status in ('active','pending_review');
 end if;
 insert into payment_events(payment_id,event_type,payload) values(p.id,p_status,p_evidence);
end $$;
revoke all on function public.settle_nowpayment(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.settle_nowpayment(uuid,text,text,jsonb) to service_role;

-- Sole eligibility definition; service RPC exposes only public creative fields.
create view public.eligible_ads as
 select c.id as campaign_id,c.slot_id,a.id as creative_id,a.title,a.image_url,a.destination_url
 from campaigns c join ad_creatives a on a.id=c.creative_id and a.slot_id=c.slot_id and a.advertiser_id=c.advertiser_id
 join payments p on p.id=c.payment_id and p.advertiser_id=c.advertiser_id
 join ad_slots s on s.id=c.slot_id
 where c.status='active' and c.start_date<=current_date and c.end_date>current_date
 and a.status='approved' and p.status='confirmed' and s.status<>'maintenance' and active_advertiser(c.advertiser_id);
revoke all on public.eligible_ads from public,anon,authenticated;
grant select on public.eligible_ads to service_role;

-- Anonymous inserts must pass validated server handlers, not direct PostgREST.
drop policy "Anyone can insert reports" on public.reports;
drop policy "Anyone can insert support tickets" on public.support_tickets;
drop policy "Anyone can insert video events" on public.video_events;
-- A lost provider response is recovered by the admin API, never by a browser
-- claiming a payment succeeded. The caller has fetched and checked provider truth.
create function public.bind_nowpayment(p_payment uuid,p_provider text,p_address text,p_amount text) returns void language plpgsql security definer set search_path=public as $$
begin
 update payments set provider_payment_id=p_provider,payment_address=p_address,expected_amount=p_amount,status='awaiting_confirmation'
 where id=p_payment and provider='nowpayments' and status='pending' and provider_payment_id is null;
 if not found then raise exception 'Payment cannot be rebound'; end if;
 insert into payment_events(payment_id,event_type,payload) values(p_payment,'provider_identity_recovered',jsonb_build_object('provider_payment_id',p_provider));
end $$;
revoke all on function public.bind_nowpayment(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bind_nowpayment(uuid,text,text,text) to service_role;
commit;
