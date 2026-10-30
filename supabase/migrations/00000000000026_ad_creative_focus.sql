-- Any banner shape, animated GIFs, and the framing an advertiser chose.
--
-- The placement is a fixed 16:9 box, but the creative no longer has to be:
-- checkout lets the advertiser drop in any picture or GIF and drag/zoom it
-- inside the frame. The chosen framing lives here so every placement — rails,
-- in-feed banners, the interstitial and the admin review — renders the same
-- crop the advertiser approved.

alter table public.ad_orders
  drop constraint if exists ad_orders_file_type_check;

alter table public.ad_orders
  add constraint ad_orders_file_type_check
  check (file_type in ('image/jpeg', 'image/png', 'image/gif'));

alter table public.ad_orders
  add column if not exists focus_x numeric(5, 2) not null default 50,
  add column if not exists focus_y numeric(5, 2) not null default 50,
  add column if not exists focus_zoom numeric(4, 2) not null default 1;

alter table public.ad_orders
  drop constraint if exists ad_orders_focus_range_check;

alter table public.ad_orders
  add constraint ad_orders_focus_range_check
  check (
    focus_x between 0 and 100
    and focus_y between 0 and 100
    and focus_zoom between 1 and 3
  );

comment on column public.ad_orders.focus_x is
  'Horizontal focal point as a percentage of the creative (CSS object-position x).';
comment on column public.ad_orders.focus_y is
  'Vertical focal point as a percentage of the creative (CSS object-position y).';
comment on column public.ad_orders.focus_zoom is
  'Scale applied around the focal point so a small detail can fill the 16:9 frame.';

-- The insert needs the three new values, and a Postgres function cannot gain
-- parameters through CREATE OR REPLACE, so drop the old signature first.
drop function if exists public.submit_ad_order(
  integer, integer, text, text, text, text, text, text, text, text, integer, text, text, text
);

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
  p_paypal_transaction_id text default null,
  p_focus_x numeric default 50,
  p_focus_y numeric default 50,
  p_focus_zoom numeric default 1
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_price integer;
  v_id uuid;
  v_focus_x numeric := coalesce(p_focus_x, 50);
  v_focus_y numeric := coalesce(p_focus_y, 50);
  v_focus_zoom numeric := coalesce(p_focus_zoom, 1);
begin
  if p_duration_months not in (1,2,3,6,12) then
    raise exception 'Invalid advertising duration';
  end if;

  if v_focus_x not between 0 and 100
    or v_focus_y not between 0 and 100
    or v_focus_zoom not between 1 and 3 then
    raise exception 'Invalid creative framing';
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
    paypal_transaction_id,
    focus_x,
    focus_y,
    focus_zoom
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
    nullif(p_paypal_transaction_id, ''),
    v_focus_x,
    v_focus_y,
    v_focus_zoom
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.submit_ad_order(
  integer, integer, text, text, text, text, text, text, text, text, integer, text, text, text, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.submit_ad_order(
  integer, integer, text, text, text, text, text, text, text, text, integer, text, text, text, numeric, numeric, numeric
) to service_role;
