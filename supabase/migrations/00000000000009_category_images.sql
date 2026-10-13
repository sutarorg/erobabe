-- Category card thumbnails.
--
-- The admin uploads one image per category; it is rendered on the category
-- cards (/categories and the homepage strip). Images live in the public
-- `video-thumbnails` Supabase Storage bucket (created by migration
-- 00000000000004) and only their public URL is stored here.
--
-- Additive, forward-only, and repeatable: existing rows keep NULL and keep
-- rendering the Lucide icon they already use.

alter table public.categories
  add column if not exists image_url text;

comment on column public.categories.image_url is
  'Public URL of the admin-uploaded category card thumbnail (Supabase Storage video-thumbnails bucket). NULL means the card falls back to its Lucide icon.';

-- Public pages read categories through the service role, but the anon role can
-- read them too (RLS policy "Anyone can read categories"), so no policy change
-- is needed for the new column.
