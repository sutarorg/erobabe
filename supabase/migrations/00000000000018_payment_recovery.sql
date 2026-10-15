begin;
-- Recovery changes must be forward-only. Deploy the matching admin handler:
-- the old four-argument service RPC no longer permits unaudited binding.
drop function public.bind_nowpayment(uuid,text,text,text);
create function public.bind_nowpayment(p_admin uuid,p_payment uuid,p_provider text,p_address text,p_amount text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p payments;
begin
 if not exists(select 1 from profiles where id=p_admin and role='admin' and status='active') then
   raise exception 'Active admin required';
 end if;
 if p_provider is null or p_provider !~ '^[0-9]{1,40}$'
   or p_address is null or length(p_address) not between 1 and 512 or p_address ~ '[[:space:]]'
   or p_amount is null or p_amount !~ '^[0-9]{1,40}([.][0-9]{1,18})?$' then
   raise exception 'Invalid recovery quote';
 end if;
 if p_amount::numeric<=0 then raise exception 'Invalid recovery amount'; end if;
 select * into p from payments where id=p_payment for update;
 if not found or p.provider is distinct from 'nowpayments' then raise exception 'Payment not found'; end if;
 if p.provider_payment_id is not null then
   -- A retry after binding or settlement never changes the immutable quote.
   if p.provider_payment_id=p_provider and p.payment_address=p_address
     and p.expected_amount::numeric=p_amount::numeric then return; end if;
   raise exception 'Payment cannot be rebound';
 end if;
 if p.status<>'pending' then raise exception 'Payment cannot be recovered'; end if;
 update payments set provider_payment_id=p_provider,payment_address=p_address,expected_amount=p_amount,status='awaiting_confirmation' where id=p.id;
 insert into payment_events(payment_id,event_type,payload)
   values(p.id,'provider_identity_recovered',jsonb_build_object('provider_payment_id',p_provider,'actor_id',p_admin));
 insert into audit_logs(actor_id,action,target_type,target_id,level,metadata)
   values(p_admin,'provider_identity_recovered','payment',p.id::text,'info',jsonb_build_object('provider_payment_id',p_provider));
end $$;
revoke all on function public.bind_nowpayment(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bind_nowpayment(uuid,uuid,text,text,text) to service_role;
commit;
