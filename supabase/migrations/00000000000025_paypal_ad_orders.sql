-- Guest PayPal advertising checkout and manual operator review.
-- The former advertiser portal is not used by this flow. Advertising orders
-- contain only the contact details needed for moderation and fulfilment.
begin;

create table public.ad_orders (
  id uuid primary key default gen_random_uuid(),
  slot_id integer not null references public.ad_slots(id),
  ad_name text not null,
  contact_name text not null,
  company_name text,
  email text not null,
  about_advertiser text not null,
  destination_url text not null,
  image_url text not null,
  image_path text not null unique,
  file_size integer not null check (file_size > 0 and file_size <= 5242880),
  file_type text not null check (file_type in ('image/jpeg','image/png')),
  dimensions text not null,
  duration_months integer not null check (duration_months in (1,2,3,6,12)),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  paypal_transaction_id text,
  payment_status text not null default 'unverified' check (payment_status in ('unverified','verified')),
  payment_verified_by uuid references public.profiles(id),
  payment_verified_at timestamptz,
  status text not null default 'in_review' check (status in ('in_review','live','rejected','paused')),
  starts_at timestamptz,
  ends_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  live_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_orders_contact_length check (
    length(ad_name) between 1 and 160
    and length(contact_name) between 1 and 120
    and length(email) between 3 and 320
    and length(about_advertiser) between 1 and 2000
    and (company_name is null or length(company_name) <= 160)
  ),
  constraint ad_orders_safe_urls check (
    destination_url ~ '^https?://'
    and image_url ~ '^https://'
    and length(destination_url) <= 2048
    and length(image_url) <= 2048
  ),
  constraint ad_orders_live_verified check (
    status <> 'live' or (
      payment_status = 'verified'
      and payment_verified_at is not null
      and starts_at is not null
      and ends_at is not null
    )
  )
);

create index idx_ad_orders_created on public.ad_orders(created_at desc);
create index idx_ad_orders_review on public.ad_orders(status, payment_status, created_at desc);
create index idx_ad_orders_slot on public.ad_orders(slot_id, status);

alter table public.ad_orders enable row level security;
-- No anon/authenticated policies: submissions and reviews pass exclusively
-- through the validated server handlers below.
revoke all on public.ad_orders from public, anon, authenticated;
grant all on public.ad_orders to service_role;

create trigger set_updated_at_ad_orders
before update on public.ad_orders
for each row execute function public.handle_updated_at();

-- The bucket is shared with historical creatives. Browser writes remain
-- prohibited; the service-role submit route uploads to the orders/ prefix.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'ad-creatives',
  'ad-creatives',
  true,
  10485760,
  array['image/jpeg','image/png','image/gif']
)
on conflict(id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Price is always read from ad_slots. The slot row lock serializes concurrent
-- submissions so two guests cannot reserve the same open placement.
create function public.submit_ad_order(
  p_slot_id integer,
  p_duration_months integer,
  p_ad_name text,
  p_contact_name text,
  p_company_name text,
  p_email text,
  p_about_advertiser text,
  p_destination_url text,
  p_image_url text,
  p_image_path text,
  p_file_size integer,
  p_file_type text,
  p_dimensions text,
  p_paypal_transaction_id text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_price integer;
  v_id uuid;
begin
  if p_duration_months not in (1,2,3,6,12) then
    raise exception 'Invalid advertising duration';
  end if;

  select price_cents into v_price
  from public.ad_slots
  where id = p_slot_id and status = 'available'
  for update;

  if not found then
    raise exception 'This ad slot is unavailable' using errcode = '23P01';
  end if;

  if exists (
    select 1 from public.ad_orders o
    where o.slot_id = p_slot_id
      and (
        o.status in ('in_review','paused')
        or (o.status = 'live' and o.ends_at > now())
      )
  ) then
    raise exception 'This ad slot was just reserved' using errcode = '23P01';
  end if;

  -- Keep historical campaigns and new guest orders from occupying one slot.
  if exists (
    select 1 from public.campaigns c
    where c.slot_id = p_slot_id
      and c.end_date > current_date
      and (
        c.status in ('active','paused','pending_review')
        or (c.status = 'pending_payment' and c.hold_expires_at > now())
      )
  ) then
    raise exception 'This ad slot is unavailable' using errcode = '23P01';
  end if;

  insert into public.ad_orders (
    slot_id,
    duration_months,
    ad_name,
    contact_name,
    company_name,
    email,
    about_advertiser,
    destination_url,
    image_url,
    image_path,
    file_size,
    file_type,
    dimensions,
    amount_cents,
    paypal_transaction_id
  ) values (
    p_slot_id,
    p_duration_months,
    p_ad_name,
    p_contact_name,
    nullif(p_company_name, ''),
    lower(p_email),
    p_about_advertiser,
    p_destination_url,
    p_image_url,
    p_image_path,
    p_file_size,
    p_file_type,
    p_dimensions,
    v_price * p_duration_months,
    nullif(p_paypal_transaction_id, '')
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_ad_order(integer,integer,text,text,text,text,text,text,text,text,integer,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_ad_order(integer,integer,text,text,text,text,text,text,text,text,integer,text,text,text) to service_role;

-- Manual review actions. Confirming payment never makes an ad live by itself;
-- the operator must also approve the creative with make_live.
create function public.admin_review_ad_order(
  p_admin uuid,
  p_order_id uuid,
  p_action text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.ad_orders;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_admin and role = 'admin' and status = 'active'
  ) then
    raise exception 'Active admin required';
  end if;

  select * into v_order from public.ad_orders where id = p_order_id for update;
  if not found then raise exception 'Ad order not found'; end if;

  if p_action = 'verify_payment' then
    if v_order.status <> 'in_review' or v_order.payment_status <> 'unverified' then
      raise exception 'This payment has already been reviewed';
    end if;
    update public.ad_orders
    set payment_status = 'verified',
        payment_verified_by = p_admin,
        payment_verified_at = now()
    where id = p_order_id;

  elsif p_action = 'make_live' then
    if v_order.status <> 'in_review' or v_order.payment_status <> 'verified' then
      raise exception 'Confirm the PayPal payment before making this ad live';
    end if;

    -- Serialize activation with submissions and other activations for this slot.
    perform 1 from public.ad_slots where id = v_order.slot_id for update;
    if exists (
      select 1 from public.ad_slots
      where id = v_order.slot_id and status = 'maintenance'
    ) then
      raise exception 'This ad slot is under maintenance';
    end if;
    if exists (
      select 1 from public.ad_orders o
      where o.id <> p_order_id
        and o.slot_id = v_order.slot_id
        and o.status = 'live'
        and o.ends_at > now()
    ) then
      raise exception 'Another ad is already live in this slot' using errcode = '23P01';
    end if;
    if exists (
      select 1 from public.campaigns c
      where c.slot_id = v_order.slot_id
        and c.end_date > current_date
        and c.status in ('active','paused','pending_review')
    ) then
      raise exception 'A historical campaign still occupies this slot' using errcode = '23P01';
    end if;

    update public.ad_orders
    set status = 'live',
        starts_at = now(),
        ends_at = now() + make_interval(months => v_order.duration_months),
        reviewed_by = p_admin,
        reviewed_at = now()
    where id = p_order_id;

  elsif p_action = 'reject_ad' then
    if v_order.status <> 'in_review' then
      raise exception 'Only an ad in review can be rejected';
    end if;
    update public.ad_orders
    set status = 'rejected', reviewed_by = p_admin, reviewed_at = now()
    where id = p_order_id;

  else
    raise exception 'Unknown ad review action';
  end if;

  insert into public.audit_logs(actor_id,action,target_type,target_id,level)
  values(p_admin,'ad_order_' || p_action,'ad_order',p_order_id::text,'info');
end;
$$;

revoke all on function public.admin_review_ad_order(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_review_ad_order(uuid,uuid,text) to service_role;

commit;
