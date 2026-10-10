-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.tags enable row level security;
alter table public.videos enable row level security;
alter table public.video_tags enable row level security;
alter table public.rights_records enable row level security;
alter table public.video_events enable row level security;
alter table public.ad_slots enable row level security;
alter table public.advertiser_profiles enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.invoices enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_reservations enable row level security;
alter table public.reports enable row level security;
alter table public.support_tickets enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.site_settings enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_videos enable row level security;
alter table public.upload_jobs enable row level security;

-- Grant usage to anon and authenticated (RLS will filter)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Profiles policies
create policy "Public can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id or public.is_admin());

create policy "Admin can view all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "Users can update own profile (limited)"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Admin can update profiles"
  on public.profiles for update
  to authenticated
  using (public.is_admin());

create policy "Service role can insert profiles"
  on public.profiles for insert
  to service_role
  with check (true);

-- Categories: public read, admin write
create policy "Anyone can read categories"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "Admin can manage categories"
  on public.categories for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Tags: public read, admin write
create policy "Anyone can read tags"
  on public.tags for select
  to anon, authenticated
  using (true);

create policy "Admin can manage tags"
  on public.tags for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Videos: anon can read only published public cleared approved
create policy "Public can read published videos"
  on public.videos for select
  to anon, authenticated
  using (
    status = 'published'
    and visibility = 'public'
    and rights_status = 'cleared'
    and moderation_status = 'approved'
  );

create policy "Admin can read all videos"
  on public.videos for select
  to authenticated
  using (public.is_admin());

create policy "Admin can manage videos"
  on public.videos for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Video tags
create policy "Public can read video_tags for published videos"
  on public.video_tags for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.videos v
      where v.id = video_id
      and v.status = 'published'
      and v.visibility = 'public'
      and v.rights_status = 'cleared'
      and v.moderation_status = 'approved'
    )
  );

create policy "Admin can manage video_tags"
  on public.video_tags for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Rights records: admin only, plus service_role
create policy "Admin can manage rights_records"
  on public.rights_records for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Video events: anyone can insert view events, but only admin can read aggregates? Allow public insert, admin read
create policy "Anyone can insert video events"
  on public.video_events for insert
  to anon, authenticated
  with check (true);

create policy "Admin can read video events"
  on public.video_events for select
  to authenticated
  using (public.is_admin());

create policy "Advertiser can read own campaign events via service role only"
  on public.video_events for select
  to service_role
  using (true);

-- Ad slots: public read, admin manage
create policy "Anyone can read ad_slots"
  on public.ad_slots for select
  to anon, authenticated
  using (true);

create policy "Admin can manage ad_slots"
  on public.ad_slots for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Advertiser profiles: own read, admin read all
create policy "Advertiser can read own profile"
  on public.advertiser_profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "Admin can read all advertiser_profiles"
  on public.advertiser_profiles for select
  to authenticated
  using (public.is_admin());

create policy "Advertiser can update own profile"
  on public.advertiser_profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Admin can manage advertiser_profiles"
  on public.advertiser_profiles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Authenticated can insert own advertiser_profile"
  on public.advertiser_profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Ad creatives: advertiser own, admin all
create policy "Advertiser can manage own creatives"
  on public.ad_creatives for all
  to authenticated
  using (advertiser_id = auth.uid())
  with check (advertiser_id = auth.uid());

create policy "Admin can manage all creatives"
  on public.ad_creatives for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Campaigns: advertiser own, admin all
create policy "Advertiser can manage own campaigns"
  on public.campaigns for all
  to authenticated
  using (advertiser_id = auth.uid())
  with check (advertiser_id = auth.uid());

create policy "Admin can manage all campaigns"
  on public.campaigns for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Payments: advertiser own, admin all, service_role for callbacks
create policy "Advertiser can read own payments"
  on public.payments for select
  to authenticated
  using (advertiser_id = auth.uid());

create policy "Admin can read all payments"
  on public.payments for select
  to authenticated
  using (public.is_admin());

create policy "Service role can manage payments (callbacks)"
  on public.payments for all
  to service_role
  using (true)
  with check (true);

create policy "Authenticated can insert own payment"
  on public.payments for insert
  to authenticated
  with check (advertiser_id = auth.uid());

-- Payment events: service_role only + admin read
create policy "Admin can read payment_events"
  on public.payment_events for select
  to authenticated
  using (public.is_admin());

create policy "Service role can manage payment_events"
  on public.payment_events for all
  to service_role
  using (true)
  with check (true);

-- Invoices: advertiser own, admin all
create policy "Advertiser can read own invoices"
  on public.invoices for select
  to authenticated
  using (advertiser_id = auth.uid());

create policy "Admin can manage all invoices"
  on public.invoices for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Service role can manage invoices"
  on public.invoices for all
  to service_role
  using (true)
  with check (true);

-- Campaign reservations: advertiser own + admin
create policy "Advertiser can manage own reservations"
  on public.campaign_reservations for all
  to authenticated
  using (advertiser_id = auth.uid())
  with check (advertiser_id = auth.uid());

create policy "Admin can manage all reservations"
  on public.campaign_reservations for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Service role can manage reservations"
  on public.campaign_reservations for all
  to service_role
  using (true)
  with check (true);

-- Reports: anyone can insert, admin manage, advertiser can read own related?
create policy "Anyone can insert reports"
  on public.reports for insert
  to anon, authenticated
  with check (true);

create policy "Admin can manage reports"
  on public.reports for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Support tickets: anyone can insert, own read, admin all
create policy "Anyone can insert support tickets"
  on public.support_tickets for insert
  to anon, authenticated
  with check (true);

create policy "Advertiser can read own tickets"
  on public.support_tickets for select
  to authenticated
  using (advertiser_id = auth.uid() or public.is_admin());

create policy "Admin can manage support tickets"
  on public.support_tickets for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Notifications: user own + admin
create policy "User can manage own notifications"
  on public.notifications for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "Admin can read all notifications"
  on public.notifications for select
  to authenticated
  using (public.is_admin());

-- Audit logs: admin read, service_role insert
create policy "Admin can read audit_logs"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

create policy "Service role and admin can insert audit_logs"
  on public.audit_logs for insert
  to authenticated, service_role
  with check (true);

-- Site settings: public read, admin write
create policy "Anyone can read site_settings"
  on public.site_settings for select
  to anon, authenticated
  using (true);

create policy "Admin can update site_settings"
  on public.site_settings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Playlists: public read published? For now admin manage, public read
create policy "Anyone can read playlists"
  on public.playlists for select
  to anon, authenticated
  using (true);

create policy "Admin can manage playlists"
  on public.playlists for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Anyone can read playlist_videos for public playlists"
  on public.playlist_videos for select
  to anon, authenticated
  using (true);

create policy "Admin can manage playlist_videos"
  on public.playlist_videos for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Upload jobs: admin only
create policy "Admin can manage upload_jobs"
  on public.upload_jobs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Grants for anon/authenticated to read public tables (needed for RLS)
grant select on public.categories to anon, authenticated;
grant select on public.tags to anon, authenticated;
grant select on public.videos to anon, authenticated;
grant select on public.video_tags to anon, authenticated;
grant select on public.ad_slots to anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant select on public.playlists to anon, authenticated;
grant select on public.playlist_videos to anon, authenticated;

grant all on public.profiles to authenticated;
grant all on public.advertiser_profiles to authenticated;
grant all on public.ad_creatives to authenticated;
grant all on public.campaigns to authenticated;
grant all on public.payments to authenticated;
grant all on public.invoices to authenticated;
grant all on public.campaign_reservations to authenticated;
grant all on public.reports to anon, authenticated;
grant all on public.support_tickets to anon, authenticated;
grant all on public.notifications to authenticated;
grant select on public.audit_logs to authenticated;
grant insert on public.video_events to anon, authenticated;
grant select on public.video_events to authenticated;
grant all on public.upload_jobs to authenticated;
