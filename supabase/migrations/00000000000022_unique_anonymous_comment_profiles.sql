begin;

-- Anonymous visitors receive their server-generated AI username on their first
-- comment. Store only a purpose-scoped HMAC of the browser ID, never the raw ID,
-- so the same visitor keeps one handle and handles are globally unique.
create table public.anonymous_comment_profiles (
  visitor_hash text primary key check (visitor_hash ~ '^[0-9a-f]{64}$'),
  profile_name text not null check (char_length(profile_name) between 3 and 60),
  created_at timestamptz not null default now()
);

create unique index anonymous_comment_profiles_profile_name_ci
  on public.anonymous_comment_profiles (lower(profile_name));

alter table public.anonymous_comment_profiles enable row level security;
revoke all on public.anonymous_comment_profiles from anon, authenticated;
grant all on public.anonymous_comment_profiles to service_role;

comment on table public.anonymous_comment_profiles is
  'Server-only mapping of HMACed anonymous visitor IDs to globally unique, AI-generated comment usernames.';
comment on column public.anonymous_comment_profiles.visitor_hash is
  'Purpose-scoped HMAC; raw browser visitor IDs are never stored.';

commit;
