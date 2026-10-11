-- Admin publishing enhancements and advertiser profile hardening.

-- External iframe sources are a first-class video provider. Existing rows keep
-- their current provider value unchanged.
alter table public.videos drop constraint if exists videos_provider_check;
alter table public.videos
  add constraint videos_provider_check
  check (provider in ('uqload', 'bunny', 'cloudflare', 'internal', 's3', 'embed'));

-- A browser session must never be able to promote itself, unsuspend itself, or
-- change its account identifier/email. The RLS policy still verifies ownership;
-- these column grants limit the fields that an authenticated user can update.
revoke update on table public.profiles from authenticated;
grant update (display_name, company_name, contact_name, website, country)
  on table public.profiles to authenticated;

-- Create both safe advertiser records inside the trusted auth trigger. This
-- works even when email confirmation means a newly signed-up browser has no
-- authenticated database session yet.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, display_name, company_name, contact_name)
  values (
    new.id,
    new.email,
    'advertiser',
    split_part(new.email, '@', 1),
    nullif(new.raw_user_meta_data ->> 'company_name', ''),
    nullif(new.raw_user_meta_data ->> 'contact_name', '')
  );

  insert into public.advertiser_profiles (id, company_name, contact_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'company_name', ''), split_part(new.email, '@', 1), 'Advertiser'),
    nullif(new.raw_user_meta_data ->> 'contact_name', '')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Backfill advertiser-profile rows created before the trigger made them.
insert into public.advertiser_profiles (id, company_name, contact_name, website, country)
select
  p.id,
  coalesce(nullif(p.company_name, ''), split_part(coalesce(p.email, ''), '@', 1), 'Advertiser'),
  p.contact_name,
  p.website,
  p.country
from public.profiles p
where p.role = 'advertiser'
on conflict (id) do nothing;
