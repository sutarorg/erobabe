-- First-party website analytics and guest-ad performance measurement.
--
-- Design rules that matter for the product:
--
--  * No raw IP address, no raw user-agent string and no raw referrer URL is
--    stored. A visitor is a keyed hash (HMAC-SHA256, secret held by the app),
--    a referrer is reduced to host + path, and a user-agent is reduced to
--    device / browser / OS at collection time.
--  * The visitor hash used for analytics is stable for the lifetime of a
--    visitor's network+browser pairing so "unique visitors" over a range is a
--    real distinct count (the ad-event and rate-limit hashes rotate daily and
--    are separate values).
--  * Every table is service-role only (RLS on, no anon/authenticated policy).
--  * Server-side aggregation functions keep the admin dashboard cheap: one
--    round trip per card instead of shipping raw rows to the application.
--  * Raw rows are pruned after 90 days by `prune_analytics_events()`, which is
--    invoked from the same operator cron contract as the other retention jobs.
--
-- Metrics defined by these functions (all figures are computed, never seeded):
--   pageviews      rows in analytics_pageviews created inside the range
--   sessions       sessions whose first pageview falls inside the range
--   visitors       distinct visitor hashes with a session in the range
--   engaged        sessions with >= 10 s of foreground time, or 2+ pageviews
--   bounce         a single-pageview session with < 10 s of foreground time
--   impressions    viewable ad impressions, deduplicated per visitor per hour
--   clicks         ad clicks, deduplicated per visitor per hour
--   revenue        verified PayPal order value prorated to the range (app side)
begin;

create table public.analytics_sessions (
  id uuid primary key,
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  entry_path text not null check (length(entry_path) between 1 and 400),
  exit_path text not null check (length(exit_path) between 1 and 400),
  pageview_count integer not null default 1 check (pageview_count between 1 and 100000),
  engaged_ms bigint not null default 0 check (engaged_ms >= 0),
  referrer_host text,
  referrer_path text,
  device text not null default 'other' check (device in ('desktop', 'mobile', 'tablet', 'other')),
  browser text,
  os text,
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  region text,
  city text,
  utm_source text,
  utm_medium text,
  utm_campaign text
);

create index analytics_sessions_started_idx on public.analytics_sessions (started_at desc);
create index analytics_sessions_seen_idx on public.analytics_sessions (last_seen_at desc);
create index analytics_sessions_visitor_idx on public.analytics_sessions (visitor_hash, started_at desc);
create index analytics_sessions_country_idx on public.analytics_sessions (country, started_at desc);
create index analytics_sessions_device_idx on public.analytics_sessions (device, started_at desc);

create table public.analytics_pageviews (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.analytics_sessions (id) on delete cascade,
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  path text not null check (length(path) between 1 and 400),
  referrer_host text,
  referrer_path text,
  engaged_ms integer not null default 0 check (engaged_ms between 0 and 86400000),
  created_at timestamptz not null default now()
);

create index analytics_pageviews_created_idx on public.analytics_pageviews (created_at desc);
create index analytics_pageviews_session_idx on public.analytics_pageviews (session_id, created_at);
create index analytics_pageviews_path_idx on public.analytics_pageviews (path, created_at desc);
create index analytics_pageviews_visitor_idx on public.analytics_pageviews (visitor_hash, created_at desc);

-- Guest PayPal placements are the current ad inventory. Impressions and clicks
-- are counted against the order row so a deleted advertisement takes its
-- performance (like its revenue) with it.
create table public.ad_order_events (
  id uuid primary key,
  order_id uuid not null references public.ad_orders (id) on delete cascade,
  slot_id integer not null references public.ad_slots (id),
  kind text not null check (kind in ('impression', 'click')),
  visitor_hash text not null check (visitor_hash ~ '^[0-9a-f]{64}$'),
  window_at timestamptz not null default date_trunc('hour', now()),
  created_at timestamptz not null default now(),
  unique (order_id, kind, visitor_hash, window_at)
);

create index ad_order_events_created_idx on public.ad_order_events (created_at desc);
create index ad_order_events_order_idx on public.ad_order_events (order_id, created_at desc);
create index ad_order_events_slot_idx on public.ad_order_events (slot_id, created_at desc);

alter table public.analytics_sessions enable row level security;
alter table public.analytics_pageviews enable row level security;
alter table public.ad_order_events enable row level security;

revoke all on public.analytics_sessions, public.analytics_pageviews, public.ad_order_events
  from public, anon, authenticated;
grant select, insert, update, delete
  on public.analytics_sessions, public.analytics_pageviews, public.ad_order_events
  to service_role;

-- ---------------------------------------------------------------------------
-- Collection
-- ---------------------------------------------------------------------------
-- One call per pageview, plus one final call on unload that only flushes the
-- time spent on the page being left (`p_path` null). The session row is
-- created by the first pageview and only updated by the same visitor hash, so
-- a guessed session id cannot inject pageviews into somebody else's session.
create function public.record_analytics_activity(
  p_session uuid,
  p_visitor text,
  p_path text,
  p_previous_path text default null,
  p_previous_engaged_ms integer default 0,
  p_referrer_host text default null,
  p_referrer_path text default null,
  p_device text default 'other',
  p_browser text default null,
  p_os text default null,
  p_country text default null,
  p_region text default null,
  p_city text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_engaged integer := greatest(0, least(coalesce(p_previous_engaged_ms, 0), 1800000));
begin
  if p_path is null and p_previous_path is null then
    return;
  end if;
  if p_path is not null and (p_path !~ '^/' or length(p_path) > 400) then
    raise exception 'Invalid path';
  end if;
  if p_device not in ('desktop', 'mobile', 'tablet', 'other') then
    raise exception 'Invalid device';
  end if;
  if exists (select 1 from analytics_sessions where id = p_session and visitor_hash <> p_visitor) then
    return;
  end if;

  if p_path is not null then
    insert into analytics_sessions (
      id, visitor_hash, entry_path, exit_path, referrer_host, referrer_path,
      device, browser, os, country, region, city, utm_source, utm_medium, utm_campaign
    ) values (
      p_session, p_visitor, p_path, p_path, p_referrer_host, p_referrer_path,
      p_device, p_browser, p_os, p_country, p_region, p_city,
      p_utm_source, p_utm_medium, p_utm_campaign
    )
    on conflict (id) do update set
      last_seen_at = now(),
      exit_path = excluded.exit_path,
      pageview_count = analytics_sessions.pageview_count + 1
    where analytics_sessions.visitor_hash = excluded.visitor_hash;
  else
    update analytics_sessions set last_seen_at = now()
      where id = p_session and visitor_hash = p_visitor;
  end if;

  if p_previous_path is not null and v_engaged > 0 then
    update analytics_pageviews
      set engaged_ms = engaged_ms + v_engaged
      where id = (
        select id from analytics_pageviews
        where session_id = p_session and path = p_previous_path
        order by created_at desc
        limit 1
      );
    update analytics_sessions
      set engaged_ms = engaged_ms + v_engaged
      where id = p_session and visitor_hash = p_visitor;
  end if;

  if p_path is not null then
    insert into analytics_pageviews (session_id, visitor_hash, path, referrer_host, referrer_path)
    values (p_session, p_visitor, p_path, p_referrer_host, p_referrer_path);
  end if;
end $$;

revoke all on function public.record_analytics_activity(
  uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_analytics_activity(
  uuid, text, text, text, integer, text, text, text, text, text, text, text, text, text, text, text
) to service_role;

-- A click or a viewable impression for one live guest placement. Returns false
-- when the order is not live, the slot does not match, or the event was already
-- counted for this visitor in this hour.
create function public.record_ad_order_event(
  p_id uuid,
  p_order uuid,
  p_slot integer,
  p_kind text,
  p_visitor text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  if p_kind not in ('impression', 'click') then
    raise exception 'Invalid event';
  end if;
  if not exists (
    select 1 from ad_orders o
    where o.id = p_order
      and o.slot_id = p_slot
      and o.status = 'live'
      and o.payment_status = 'verified'
      and o.starts_at is not null and o.starts_at <= now()
      and o.ends_at is not null and o.ends_at > now()
  ) then
    return false;
  end if;

  insert into ad_order_events (id, order_id, slot_id, kind, visitor_hash)
  values (p_id, p_order, p_slot, p_kind, p_visitor)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.record_ad_order_event(uuid, uuid, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.record_ad_order_event(uuid, uuid, integer, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Aggregates for the admin dashboard
-- ---------------------------------------------------------------------------
create function public.analytics_overview(
  p_from timestamptz,
  p_to timestamptz,
  p_path text default null
) returns table (
  pageviews bigint,
  sessions bigint,
  visitors bigint,
  engaged_sessions bigint,
  bounces bigint,
  engaged_seconds numeric
)
language plpgsql security definer set search_path = public as $$
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;

  return query
  with scoped as (
    select s.*
    from analytics_sessions s
    where s.started_at >= p_from and s.started_at < p_to
      and (
        p_path is null
        or exists (select 1 from analytics_pageviews pv where pv.session_id = s.id and pv.path = p_path)
      )
  )
  select
    (select count(*)::bigint from analytics_pageviews pv
      where pv.created_at >= p_from and pv.created_at < p_to
        and (p_path is null or pv.path = p_path)) as pageviews,
    (select count(*)::bigint from scoped) as sessions,
    (select count(distinct scoped.visitor_hash)::bigint from scoped) as visitors,
    (select count(*)::bigint from scoped
      where scoped.engaged_ms >= 10000 or scoped.pageview_count > 1) as engaged_sessions,
    (select count(*)::bigint from scoped
      where scoped.pageview_count = 1 and scoped.engaged_ms < 10000) as bounces,
    (select coalesce(sum(scoped.engaged_ms), 0) / 1000.0 from scoped) as engaged_seconds;
end $$;

create function public.analytics_series(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'day',
  p_path text default null
) returns table (
  bucket timestamptz,
  pageviews bigint,
  sessions bigint,
  visitors bigint,
  engaged_seconds numeric
)
language plpgsql security definer set search_path = public as $$
declare
  v_step interval;
begin
  if p_bucket not in ('hour', 'day', 'week', 'month') then
    raise exception 'Invalid bucket';
  end if;
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  v_step := case p_bucket
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  return query
  with buckets as (
    select generate_series(
      date_trunc(p_bucket, p_from),
      date_trunc(p_bucket, p_to - interval '1 microsecond'),
      v_step
    ) as bucket
  ),
  views as (
    select date_trunc(p_bucket, pv.created_at) as bucket, count(*)::bigint as pageviews
    from analytics_pageviews pv
    where pv.created_at >= p_from and pv.created_at < p_to
      and (p_path is null or pv.path = p_path)
    group by 1
  ),
  sessions_by_bucket as (
    select date_trunc(p_bucket, s.started_at) as bucket,
      count(*)::bigint as sessions,
      count(distinct s.visitor_hash)::bigint as visitors,
      coalesce(sum(s.engaged_ms), 0) / 1000.0 as engaged_seconds
    from analytics_sessions s
    where s.started_at >= p_from and s.started_at < p_to
      and (
        p_path is null
        or exists (select 1 from analytics_pageviews pv where pv.session_id = s.id and pv.path = p_path)
      )
    group by 1
  )
  select b.bucket,
    coalesce(v.pageviews, 0),
    coalesce(x.sessions, 0),
    coalesce(x.visitors, 0),
    coalesce(x.engaged_seconds, 0)
  from buckets b
  left join views v on v.bucket = b.bucket
  left join sessions_by_bucket x on x.bucket = b.bucket
  order by b.bucket;
end $$;

-- One breakdown at a time. Page-level dimensions read the pageview table,
-- everything else reads the session table, so a session with many pageviews is
-- still one session in "Top countries" and three pageviews in "Top pages".
create function public.analytics_dimensions(
  p_from timestamptz,
  p_to timestamptz,
  p_dimension text,
  p_limit integer default 25,
  p_path text default null
) returns table (
  key text,
  pageviews bigint,
  sessions bigint,
  visitors bigint,
  engaged_seconds numeric
)
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 500));
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  if p_dimension not in (
    'path', 'referrer_host', 'referrer_path', 'entry_path', 'exit_path',
    'device', 'browser', 'os', 'country', 'region', 'city',
    'utm_source', 'utm_medium', 'utm_campaign'
  ) then
    raise exception 'Invalid dimension';
  end if;

  if p_dimension = 'path' then
    return query
    select pv.path,
      count(*)::bigint,
      count(distinct pv.session_id)::bigint,
      count(distinct pv.visitor_hash)::bigint,
      0::numeric
    from analytics_pageviews pv
    where pv.created_at >= p_from and pv.created_at < p_to
      and (p_path is null or pv.path = p_path)
    group by 1
    order by 2 desc, 1 asc
    limit v_limit;
    return;
  end if;

  return query
  select
    coalesce(
      nullif(
        case p_dimension
          when 'referrer_host' then s.referrer_host
          when 'referrer_path' then s.referrer_path
          when 'entry_path' then s.entry_path
          when 'exit_path' then s.exit_path
          when 'device' then s.device
          when 'browser' then s.browser
          when 'os' then s.os
          when 'country' then s.country
          when 'region' then s.region
          when 'city' then s.city
          when 'utm_source' then s.utm_source
          when 'utm_medium' then s.utm_medium
          else s.utm_campaign
        end,
        ''
      ),
      '(not set)'
    ) as key,
    sum(s.pageview_count)::bigint as pageviews,
    count(*)::bigint as sessions,
    count(distinct s.visitor_hash)::bigint as visitors,
    coalesce(sum(s.engaged_ms), 0) / 1000.0 as engaged_seconds
  from analytics_sessions s
  where s.started_at >= p_from and s.started_at < p_to
    and (
      p_path is null
      or exists (select 1 from analytics_pageviews pv where pv.session_id = s.id and pv.path = p_path)
    )
  group by 1
  order by 3 desc, 1 asc
  limit v_limit;
end $$;

create function public.analytics_page_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_path text
) returns table (
  pageviews bigint,
  sessions bigint,
  visitors bigint,
  engaged_seconds numeric,
  entries bigint,
  exits bigint,
  bounces bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;

  return query
  select
    (select count(*)::bigint from analytics_pageviews pv
      where pv.path = p_path and pv.created_at >= p_from and pv.created_at < p_to),
    (select count(distinct pv.session_id)::bigint from analytics_pageviews pv
      where pv.path = p_path and pv.created_at >= p_from and pv.created_at < p_to),
    (select count(distinct pv.visitor_hash)::bigint from analytics_pageviews pv
      where pv.path = p_path and pv.created_at >= p_from and pv.created_at < p_to),
    (select coalesce(sum(pv.engaged_ms), 0) / 1000.0 from analytics_pageviews pv
      where pv.path = p_path and pv.created_at >= p_from and pv.created_at < p_to),
    (select count(*)::bigint from analytics_sessions s
      where s.entry_path = p_path and s.started_at >= p_from and s.started_at < p_to),
    (select count(*)::bigint from analytics_sessions s
      where s.exit_path = p_path and s.last_seen_at >= p_from and s.last_seen_at < p_to),
    (select count(*)::bigint from analytics_sessions s
      where s.entry_path = p_path and s.pageview_count = 1 and s.engaged_ms < 10000
        and s.started_at >= p_from and s.started_at < p_to);
end $$;

-- Watch-page engagement comes from the recommendation event stream the player
-- already writes: a playback start, a completion, a like, and the number of
-- distinct viewers behind those events.
create function public.analytics_video_engagement(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 20
) returns table (
  video_id uuid,
  slug text,
  title text,
  starts bigint,
  completes bigint,
  likes bigint,
  viewers bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 100));
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;

  return query
  select v.id, v.slug, v.title,
    count(*) filter (where e.event_type = 'playback_start')::bigint,
    count(*) filter (where e.event_type = 'playback_complete')::bigint,
    count(*) filter (where e.event_type = 'like')::bigint,
    count(distinct e.viewer_hash)::bigint
  from recommendation_events e
  join videos v on v.id = e.video_id
  where e.created_at >= p_from and e.created_at < p_to
  group by v.id, v.slug, v.title
  having count(*) filter (where e.event_type = 'playback_start') > 0
     or count(distinct e.viewer_hash) > 0
  order by 4 desc, 7 desc, v.title asc
  limit v_limit;
end $$;

create function public.analytics_ad_totals(
  p_from timestamptz,
  p_to timestamptz
) returns table (
  impressions bigint,
  clicks bigint,
  visitors bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  return query
  select
    count(*) filter (where e.kind = 'impression')::bigint,
    count(*) filter (where e.kind = 'click')::bigint,
    count(distinct e.visitor_hash)::bigint
  from ad_order_events e
  where e.created_at >= p_from and e.created_at < p_to;
end $$;

create function public.analytics_ad_placements(
  p_from timestamptz,
  p_to timestamptz
) returns table (
  slot_id integer,
  slot_name text,
  side text,
  impressions bigint,
  clicks bigint,
  visitors bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  return query
  select s.id, s.name, s.side,
    count(e.id) filter (where e.kind = 'impression')::bigint,
    count(e.id) filter (where e.kind = 'click')::bigint,
    count(distinct e.visitor_hash)::bigint
  from ad_slots s
  left join ad_order_events e
    on e.slot_id = s.id and e.created_at >= p_from and e.created_at < p_to
  group by s.id, s.name, s.side
  order by s.id;
end $$;

-- Orders whose booked window overlaps the range; the application prorates the
-- amount and decides which of them count as verified revenue.
create function public.analytics_ad_orders(
  p_from timestamptz,
  p_to timestamptz
) returns table (
  order_id uuid,
  ad_name text,
  slot_id integer,
  status text,
  payment_status text,
  amount_cents integer,
  starts_at timestamptz,
  ends_at timestamptz,
  impressions bigint,
  clicks bigint,
  visitors bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  return query
  select o.id, o.ad_name, o.slot_id, o.status, o.payment_status,
    o.amount_cents, o.starts_at, o.ends_at,
    count(e.id) filter (where e.kind = 'impression')::bigint,
    count(e.id) filter (where e.kind = 'click')::bigint,
    count(distinct e.visitor_hash)::bigint
  from ad_orders o
  left join ad_order_events e
    on e.order_id = o.id and e.created_at >= p_from and e.created_at < p_to
  where o.starts_at is not null
    and o.ends_at is not null
    and o.starts_at < p_to
    and o.ends_at > p_from
  group by o.id, o.ad_name, o.slot_id, o.status, o.payment_status,
    o.amount_cents, o.starts_at, o.ends_at
  order by o.starts_at desc;
end $$;

create function public.analytics_ad_series(
  p_from timestamptz,
  p_to timestamptz,
  p_order uuid default null
) returns table (
  bucket timestamptz,
  impressions bigint,
  clicks bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if p_to <= p_from then
    raise exception 'Invalid range';
  end if;
  return query
  with buckets as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_to - interval '1 microsecond'),
      interval '1 day'
    ) as bucket
  ),
  measured as (
    select date_trunc('day', e.created_at) as bucket,
      count(*) filter (where e.kind = 'impression')::bigint as impressions,
      count(*) filter (where e.kind = 'click')::bigint as clicks
    from ad_order_events e
    where e.created_at >= p_from and e.created_at < p_to
      and (p_order is null or e.order_id = p_order)
    group by 1
  )
  select b.bucket, coalesce(m.impressions, 0), coalesce(m.clicks, 0)
  from buckets b
  left join measured m on m.bucket = b.bucket
  order by b.bucket;
end $$;

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
-- 90 days of raw pseudonymous rows is what the 90-day reporting window needs.
-- The recommendation event stream the engagement panel reads is extended from
-- 30 to 90 days for the same reason; nothing else changes about it.
create or replace function public.prune_recommendation_data()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from recommendation_events where created_at < now() - interval '90 days';
  delete from recommendation_feedback where updated_at < now() - interval '180 days';
  delete from recommendation_preferences where consent_expires_at < now();
end $$;
revoke all on function public.prune_recommendation_data() from public, anon, authenticated;
grant execute on function public.prune_recommendation_data() to service_role;

create function public.prune_analytics_events()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from analytics_pageviews where created_at < now() - interval '90 days';
  delete from analytics_sessions where started_at < now() - interval '90 days';
  -- Ad delivery evidence is kept for a year so a yearly placement report stays
  -- complete; a deleted order removes its events through the foreign key.
  delete from ad_order_events where created_at < now() - interval '400 days';
end $$;
revoke all on function public.prune_analytics_events() from public, anon, authenticated;
grant execute on function public.prune_analytics_events() to service_role;

comment on table public.analytics_sessions is
  'Pseudonymous first-party sessions: keyed visitor hash, first/last path, device class, coarse geo. No IP, UA or full referrer.';
comment on table public.analytics_pageviews is
  'One row per pageview with foreground time on page; pruned after 90 days.';
comment on table public.ad_order_events is
  'Viewable impressions and clicks for guest PayPal placements, deduplicated per visitor per hour.';

commit;
