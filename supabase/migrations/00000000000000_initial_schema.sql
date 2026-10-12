-- Erobabe initial schema
-- Enable extensions
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','advertiser')) default 'advertiser',
  email text,
  display_name text,
  company_name text,
  contact_name text,
  website text,
  country text,
  status text not null default 'active' check (status in ('active','suspended','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Categories (real taxonomy, 12 fixed + admin manageable)
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  slug text not null unique,
  icon text,
  description text,
  video_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tags
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- Videos
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  thumbnail_url text,
  provider text not null default 'internal' check (provider in ('uqload','ufoload','bunny','cloudflare','internal','s3')),
  provider_file_id text,
  playable_url text,
  embed_url text,
  duration_seconds int,
  resolution text,
  quality text check (quality in ('HD','4K')),
  status text not null default 'draft' check (status in ('draft','processing','pending_review','published','unpublished','rejected')),
  rights_status text not null default 'pending' check (rights_status in ('pending','cleared','rejected','expired')),
  visibility text not null default 'private' check (visibility in ('private','public')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected')),
  view_count bigint not null default 0,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_videos_status on public.videos(status);
create index idx_videos_visibility on public.videos(visibility);
create index idx_videos_category on public.videos(category_id);
create index idx_videos_published_at on public.videos(published_at desc);
create index idx_videos_slug on public.videos(slug);

-- Video tags M2M
create table public.video_tags (
  video_id uuid not null references public.videos(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (video_id, tag_id)
);

-- Rights records (private)
create table public.rights_records (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  ownership_type text not null check (ownership_type in ('owned','licensed','partner')),
  license_info text,
  distribution_permissions text,
  expiration_date date,
  review_history jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Video events (views, impressions)
create table public.video_events (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  event_type text not null check (event_type in ('view','impression','click')),
  user_id uuid references public.profiles(id),
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index idx_video_events_video on public.video_events(video_id, created_at desc);
create index idx_video_events_type on public.video_events(event_type);

-- Ad slots (exactly 10 fixed)
create table public.ad_slots (
  id int primary key check (id >=1 and id <=10),
  name text not null,
  side text not null check (side in ('left','right')),
  position int not null,
  price_cents int not null default 9900 check (price_cents >0),
  status text not null default 'available' check (status in ('available','reserved','active','maintenance')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Advertiser profiles (extends profiles)
create table public.advertiser_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  company_name text not null,
  contact_name text,
  website text,
  country text,
  status text not null default 'active' check (status in ('active','suspended','pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ad creatives
create table public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertiser_profiles(id) on delete cascade,
  slot_id int references public.ad_slots(id),
  title text not null,
  destination_url text not null,
  image_url text,
  file_size int,
  dimensions text,
  file_type text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  moderation_notes text,
  moderated_by uuid references public.profiles(id),
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_ad_creatives_advertiser on public.ad_creatives(advertiser_id);
create index idx_ad_creatives_slot on public.ad_creatives(slot_id);
create index idx_ad_creatives_status on public.ad_creatives(status);

-- Payments (Bcon)
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertiser_profiles(id) on delete cascade,
  invoice_number text unique,
  external_id text not null unique,
  amount_cents int not null check (amount_cents >0),
  currency text not null default 'USD',
  payment_currency text not null,
  chain text not null,
  payment_address text,
  expected_amount text,
  transaction_id text,
  status text not null default 'pending' check (status in ('pending','awaiting_confirmation','partially_confirmed','confirmed','failed','expired','overpaid','underpaid','refunded')),
  bcon_response jsonb,
  confirmed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_payments_advertiser on public.payments(advertiser_id);
create index idx_payments_status on public.payments(status);
create index idx_payments_external on public.payments(external_id);

-- Payment events (immutable audit)
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index idx_payment_events_payment on public.payment_events(payment_id, created_at desc);

-- Invoices
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  advertiser_id uuid not null references public.advertiser_profiles(id) on delete cascade,
  payment_id uuid references public.payments(id) on delete set null,
  amount_cents int not null,
  currency text not null default 'USD',
  description text,
  status text not null default 'pending' check (status in ('draft','pending','paid','failed','refunded','expired')),
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Campaigns
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references public.advertiser_profiles(id) on delete cascade,
  slot_id int not null references public.ad_slots(id),
  creative_id uuid references public.ad_creatives(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'draft' check (status in ('draft','pending_payment','pending_review','active','paused','completed','rejected','expired','cancelled')),
  price_cents int not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  progress int not null default 0 check (progress >=0 and progress <=100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_date_check check (end_date > start_date)
);
create index idx_campaigns_advertiser on public.campaigns(advertiser_id);
create index idx_campaigns_slot on public.campaigns(slot_id);
create index idx_campaigns_status on public.campaigns(status);
create index idx_campaigns_dates on public.campaigns(start_date, end_date);

-- Campaign reservation holds (temporary, to prevent race)
create table public.campaign_reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id int not null references public.ad_slots(id),
  advertiser_id uuid not null references public.advertiser_profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index idx_reservations_slot on public.campaign_reservations(slot_id, expires_at);

-- Reports / removal requests
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('video','advertisement','advertiser','copyright','other')),
  reason text not null,
  content_id text,
  content_type text,
  reported_by text,
  email text,
  details text,
  video_id uuid references public.videos(id) on delete set null,
  creative_id uuid references public.ad_creatives(id) on delete set null,
  advertiser_id uuid references public.advertiser_profiles(id) on delete set null,
  status text not null default 'new' check (status in ('new','in_review','resolved','dismissed')),
  resolution_note text,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Support tickets
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid references public.advertiser_profiles(id) on delete set null,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','in_progress','closed')),
  response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  type text not null default 'info',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, created_at desc);

-- Audit logs
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  level text not null default 'info' check (level in ('info','warning','error')),
  metadata jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
create index idx_audit_logs_actor on public.audit_logs(actor_id, created_at desc);
create index idx_audit_logs_action on public.audit_logs(action);

-- Site settings (single row)
create table public.site_settings (
  id int primary key default 1 check (id=1),
  site_title text not null default 'erobabe',
  tagline text not null default 'Your destination for discovering premium adult entertainment. 18+ adults only.',
  slot_price_cents int not null default 9900,
  support_email text,
  contact_email text,
  brand_logo_url text,
  maintenance_mode boolean not null default false,
  mature_warning boolean not null default true,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (1);

-- Playlists
create table public.playlists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.playlist_videos (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  position int not null default 0,
  primary key (playlist_id, video_id)
);

-- Upload jobs
create table public.upload_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references public.videos(id) on delete set null,
  file_name text not null,
  file_size bigint,
  provider text not null default 'ufoload',
  provider_file_id text,
  provider_upload_id text,
  provider_import_task_id text,
  provider_status text,
  status text not null default 'pending' check (status in ('pending','uploading','processing','completed','failed','cancelled')),
  progress int not null default 0,
  error_message text,
  last_checked_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Functions for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at_profiles before update on public.profiles for each row execute function public.handle_updated_at();
create trigger set_updated_at_categories before update on public.categories for each row execute function public.handle_updated_at();
create trigger set_updated_at_videos before update on public.videos for each row execute function public.handle_updated_at();
create trigger set_updated_at_ad_slots before update on public.ad_slots for each row execute function public.handle_updated_at();
create trigger set_updated_at_advertiser_profiles before update on public.advertiser_profiles for each row execute function public.handle_updated_at();
create trigger set_updated_at_ad_creatives before update on public.ad_creatives for each row execute function public.handle_updated_at();
create trigger set_updated_at_payments before update on public.payments for each row execute function public.handle_updated_at();
create trigger set_updated_at_campaigns before update on public.campaigns for each row execute function public.handle_updated_at();
create trigger set_updated_at_invoices before update on public.invoices for each row execute function public.handle_updated_at();
create trigger set_updated_at_reports before update on public.reports for each row execute function public.handle_updated_at();
create trigger set_updated_at_support_tickets before update on public.support_tickets for each row execute function public.handle_updated_at();
create trigger set_updated_at_playlists before update on public.playlists for each row execute function public.handle_updated_at();
create trigger set_updated_at_upload_jobs before update on public.upload_jobs for each row execute function public.handle_updated_at();
create trigger set_updated_at_site_settings before update on public.site_settings for each row execute function public.handle_updated_at();

-- Function to handle new user profile creation
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, display_name)
  values (new.id, new.email, 'advertiser', split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper function to check admin role (avoid RLS recursion via auth.jwt)
create or replace function public.is_admin()
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'active'
  );
end;
$$ language plpgsql security definer stable;

create or replace function public.is_advertiser()
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'advertiser' and status = 'active'
  );
end;
$$ language plpgsql security definer stable;
